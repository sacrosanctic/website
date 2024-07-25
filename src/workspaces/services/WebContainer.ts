import {
  Console,
  Data,
  Effect,
  Fiber,
  GlobalValue,
  Layer,
  Option,
  PubSub,
  Scope,
  Stream,
  SubscriptionRef,
  identity
} from "effect"
import {
  HttpClient,
  HttpClientRequest,
  HttpClientResponse
} from "@effect/platform"
import {
  FileSystemTree,
  WebContainer as WC,
  WebContainerProcess
} from "@webcontainer/api"
import { Toast, Toaster } from "@/services/Toaster"
import {
  Directory,
  File,
  FullPath,
  Workspace,
  makeDirectory
} from "../domain/workspace"
import * as Ndjson from "@effect/experimental/Ndjson"
import * as DevToolsDomain from "@effect/experimental/DevTools/Domain"

const semaphore = GlobalValue.globalValue("app/WebContainer/semaphore", () =>
  Effect.unsafeMakeSemaphore(1)
)

export type FileSystemEvent = Data.TaggedEnum<{
  readonly NodeCreated: {
    readonly node: File | Directory
    readonly path: FullPath
  }
  readonly NodeRenamed: {
    readonly node: File | Directory
    readonly oldPath: FullPath
    readonly newPath: FullPath
  }
  readonly NodeRemoved: {
    readonly node: File | Directory
    readonly path: FullPath
  }
}>
export const FileSystemEvent = Data.taggedEnum<FileSystemEvent>()

class FileValidationError extends Data.TaggedError("FileValidationError")<{
  readonly reason: "InvalidName" | "UnsupportedType"
}> {
  get message(): string {
    switch (this.reason) {
      case "InvalidName": {
        return "Directory names cannot be empty or contain '/'."
      }
      case "UnsupportedType": {
        return "The playground currently only supports creation of `.ts` files."
      }
    }
  }

  get asToast(): Omit<Toast, "id"> {
    return {
      title:
        this.reason === "InvalidName"
          ? "Invalid Name"
          : "Unsupported File Type",
      description: this.message,
      variant: "destructive",
      duration: 5000
    }
  }
}

const make = Effect.gen(function* () {
  // you can only have one container running at a time
  yield* Effect.acquireRelease(semaphore.take(1), () => semaphore.release(1))

  const { toast } = yield* Toaster

  const container = yield* Effect.acquireRelease(
    Effect.promise(() => WC.boot()),
    (_) => Effect.sync(() => _.teardown())
  )

  const activeWorkspaces = new Set<WorkspaceHandle>()
  const workspaceScopes = new WeakMap<WorkspaceHandle, Scope.Scope>()
  const plugins = new Set<WorkspacePlugin>()

  const install = (name: string, content: string) =>
    Effect.promise(async () => {
      await container.fs.writeFile(name, content)
      await container.spawn("chmod", ["+x", name])
    })
  yield* install("run", runProgram)
  yield* install("dev-tools-proxy", devToolsProxy)

  const shell = Effect.acquireRelease(
    Effect.promise(() =>
      container.spawn("jsh", [], {
        env: {
          PATH: "node_modules/.bin:/usr/local/bin:/usr/bin:/bin",
          NODE_NO_WARNINGS: "1"
        }
      })
    ),
    (process) => Effect.sync(() => process.kill())
  )
  const spawn = (command: string) =>
    Effect.acquireRelease(
      Effect.promise(() =>
        container.spawn("jsh", ["-c", command], {
          env: { PATH: "node_modules/.bin:/usr/local/bin:/usr/bin:/bin" }
        })
      ),
      (process) => Effect.sync(() => process.kill())
    )
  const run = (command: string) =>
    spawn(command).pipe(
      Effect.andThen((process) => Effect.promise(() => process.exit)),
      Effect.scoped
    )

  // start dev tools proxy
  const devToolsEvents =
    yield* PubSub.sliding<DevToolsDomain.Request.WithoutPing>(128)
  yield* spawn("./dev-tools-proxy").pipe(
    Effect.tap((process) =>
      Stream.fromReadableStream(
        () => process.output,
        (error) => error
      ).pipe(
        Stream.orDie,
        Stream.encodeText,
        Stream.pipeThroughChannel(
          Ndjson.unpackSchema(DevToolsDomain.Request)({ ignoreEmptyLines: true })
        ),
        Stream.runForEach((event) =>
          event._tag === "Ping" ? Effect.void : devToolsEvents.publish(event)
        )
      )
    ),
    Effect.forever,
    Effect.forkScoped
  )

  const workspace = (workspace: Workspace) =>
    Effect.gen(function* () {
      const fsEvents = yield* Effect.acquireRelease(
        PubSub.sliding<FileSystemEvent>(128),
        (pubsub) => PubSub.shutdown(pubsub)
      )

      const workspaceRef = yield* SubscriptionRef.make(workspace)

      const path = (_: string) => `${workspace.name}/${_}`

      yield* Effect.acquireRelease(
        Effect.promise(async () => {
          await container.fs.rm(workspace.name, {
            recursive: true,
            force: true
          })
          return container.fs.mkdir(path(".pnpm-store"), { recursive: true })
        }),
        () =>
          Effect.andThen(
            Effect.log("removing"),
            Effect.promise(() =>
              container.fs.rm(workspace.name, {
                recursive: true,
                force: true
              })
            )
          )
      )

      yield* Effect.promise(() =>
        container.fs.writeFile(path(".npmrc"), npmRc)
      )

      const snapshotsFiber = yield* Effect.forEach(
        workspace.snapshots,
        (snapshot) =>
          HttpClientRequest.get(
            `/snapshots/${encodeURIComponent(snapshot)}`
          ).pipe(
            HttpClient.fetchOk,
            HttpClientResponse.arrayBuffer,
            Effect.flatMap((buffer) =>
              Effect.promise(() =>
                container.mount(buffer, {
                  mountPoint: workspace.name + "/.pnpm-store"
                })
              )
            ),
            Effect.ignore
          ),
        { concurrency: workspace.snapshots.length, discard: true }
      ).pipe(Effect.forkScoped)

      yield* Effect.promise(() =>
        container.mount(treeFromWorkspace(workspace), {
          mountPoint: workspace.name
        })
      )

      const runWorkspace = (command: string) =>
        run(`cd ${workspace.name} && ${command}`)

      const validateName = (name: string, type: "File" | "Directory") =>
        Effect.gen(function* () {
          if (name.length === 0 || name.includes("/")) {
            return yield* new FileValidationError({ reason: "InvalidName" })
          } else if (type === "File" && !name.endsWith(".ts")) {
            return yield* new FileValidationError({
              reason: "UnsupportedType"
            })
          }
        })

      const create = (
        directory: Option.Option<Directory>,
        name: string,
        type: "File" | "Directory"
      ) =>
        Effect.gen(function* () {
          yield* Effect.log("creating")
          yield* validateName(name, type)

          const workspace = yield* workspaceRef.get
          const newPath =
            directory._tag === "None"
              ? name
              : `${Option.getOrThrow(workspace.pathTo(directory.value))}/${name}`
          yield* type === "File" ? writeFile(newPath, "") : mkdir(newPath)
          const node =
            type === "File"
              ? new File({
                  name,
                  userManaged: true,
                  initialContent: ""
                })
              : makeDirectory(name, [], true)
          yield* SubscriptionRef.set(
            workspaceRef,
            directory._tag === "Some"
              ? workspace.replaceNode(
                  directory.value,
                  makeDirectory(
                    directory.value.name,
                    [...directory.value.children, node],
                    directory.value.userManaged
                  )
                )
              : workspace.append(node)
          )
          yield* PubSub.publish(
            fsEvents,
            FileSystemEvent.NodeCreated({
              node,
              path:
                directory._tag === "None"
                  ? FullPath(name)
                  : FullPath(
                      `${Option.getOrThrow(workspace.fullPathTo(directory.value))}/${name}`
                    )
            })
          )
          return node
        }).pipe(
          Effect.tapErrorTag("FileValidationError", (error) =>
            toast(error.asToast)
          ),
          Effect.tapErrorCause(Effect.log),
          Effect.annotateLogs({
            service: "WebContainer",
            name,
            type
          })
        )

      const rename = (file: File | Directory, newName: string) =>
        Effect.gen(function* () {
          yield* Effect.log("renaming")
          yield* validateName(newName, file._tag)
          const workspace = yield* workspaceRef.get
          const newNode =
            file._tag === "Directory"
              ? makeDirectory(newName, file.children, file.userManaged)
              : new File({ ...file, name: newName })
          const newWorkspace = workspace.replaceNode(file, newNode)
          const oldPath = yield* Effect.orDie(workspace.pathTo(file))
          const newPath = yield* Effect.orDie(newWorkspace.pathTo(newNode))
          yield* Effect.promise(() =>
            container.fs.rename(path(oldPath), path(newPath))
          )
          yield* SubscriptionRef.set(workspaceRef, newWorkspace)
          yield* PubSub.publish(
            fsEvents,
            FileSystemEvent.NodeRenamed({
              node: newNode,
              oldPath: yield* Effect.orDie(workspace.fullPathTo(file)),
              newPath: yield* Effect.orDie(newWorkspace.fullPathTo(newNode))
            })
          )
          return newNode
        }).pipe(
          Effect.tapErrorTag("FileValidationError", (error) =>
            toast(error.asToast)
          ),
          Effect.tapErrorCause(Effect.log),
          Effect.annotateLogs({
            service: "WebContainer",
            file,
            newName
          })
        )

      const remove = (node: File | Directory) =>
        Effect.gen(function* () {
          yield* Effect.log("removing")
          const workspace = yield* workspaceRef.get
          const newWorkspace = workspace.removeNode(node)
          const nodePath = yield* Effect.orDie(workspace.pathTo(node))
          yield* Effect.promise(() =>
            container.fs.rm(path(nodePath), { recursive: true })
          )
          yield* SubscriptionRef.set(workspaceRef, newWorkspace)
          yield* PubSub.publish(
            fsEvents,
            FileSystemEvent.NodeRemoved({
              node,
              path: yield* Effect.orDie(workspace.fullPathTo(node))
            })
          )
        }).pipe(
          Effect.tapErrorCause(Effect.log),
          Effect.annotateLogs({
            service: "WebContainer",
            node
          })
        )

      const writeFile = (file: string, data: string) =>
        Effect.promise(() => container.fs.writeFile(path(file), data))

      const readFile = (file: string) =>
        Effect.tryPromise({
          try: () => container.fs.readFile(path(file)),
          catch: () => new FileNotFoundError({ file })
        }).pipe(Effect.map((bytes) => new TextDecoder().decode(bytes)))

      const mkdir = (directory: string) =>
        Effect.promise(() => container.fs.mkdir(path(directory)))

      const watchFile = (file: string) => {
        const changes = Stream.async<void>((emit) => {
          const watcher = container.fs.watch(path(file), (_event) => {
            emit.single(void 0)
          })
          return Effect.sync(() => watcher.close())
        }).pipe(Stream.mapEffect(() => readFile(file)))
        return readFile(file).pipe(Stream.concat(changes), Stream.changes)
      }

      const handle = identity<WorkspaceHandle>({
        workspace: workspaceRef,
        create,
        rename,
        remove,
        write: writeFile,
        read: readFile,
        watch: watchFile,
        fsEvents: Stream.fromPubSub(fsEvents),
        run: runWorkspace,
        shell,
        awaitSnapshots: Fiber.join(snapshotsFiber)
      })

      activeWorkspaces.add(handle)
      const scope = yield* Effect.scope

      workspaceScopes.set(handle, scope)
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => activeWorkspaces.delete(handle))
      )

      yield* Effect.forEach(plugins, (plugin) => plugin(handle), {
        discard: true
      })

      return handle
    }).pipe(Effect.annotateLogs({ workspace: workspace.name }))

  const registerPlugin = (plugin: WorkspacePlugin) =>
    Effect.suspend(() => {
      plugins.add(plugin)
      return Effect.forEach(
        activeWorkspaces,
        (handle) =>
          plugin(handle).pipe(Scope.extend(workspaceScopes.get(handle)!)),
        { discard: true }
      )
    }).pipe(
      Effect.interruptible,
      Effect.acquireRelease(() =>
        Effect.sync(() => {
          plugins.delete(plugin)
        })
      ),
      Effect.asVoid
    )

  return {
    workspace,
    registerPlugin,
    devTools: Stream.fromPubSub(devToolsEvents)
  } as const
}).pipe(
  Effect.annotateLogs({
    service: "WebContainer"
  })
)

export class WebContainer extends Effect.Tag("WebContainer")<
  WebContainer,
  Effect.Effect.Success<typeof make>
>() {
  static Live = Layer.scoped(this, make).pipe(Layer.provide(Toaster.Live))
}

export class FileNotFoundError extends Data.TaggedError("FileNotFoundError")<{
  readonly file: string
}> {}

export class WebContainerError extends Data.TaggedError("WebContainerError")<{
  readonly message: string
}> {}

export interface WorkspaceHandle {
  readonly workspace: SubscriptionRef.SubscriptionRef<Workspace>
  readonly create: (
    parent: Option.Option<Directory>,
    name: string,
    type: "File" | "Directory"
  ) => Effect.Effect<File | Directory, FileValidationError>
  readonly rename: (
    node: File | Directory,
    newName: string
  ) => Effect.Effect<File | Directory, FileValidationError>
  readonly remove: (node: File | Directory) => Effect.Effect<void>
  readonly write: (file: string, data: string) => Effect.Effect<void>
  readonly read: (file: string) => Effect.Effect<string, FileNotFoundError>
  readonly watch: (file: string) => Stream.Stream<string, FileNotFoundError>
  readonly fsEvents: Stream.Stream<FileSystemEvent>
  readonly shell: Effect.Effect<WebContainerProcess, never, Scope.Scope>
  readonly run: (command: string) => Effect.Effect<number>
  readonly awaitSnapshots: Effect.Effect<void>
}

export interface WorkspacePlugin {
  (handle: WorkspaceHandle): Effect.Effect<void, never, Scope.Scope>
}

function treeFromWorkspace(workspace: Workspace): FileSystemTree {
  function walk(children: Workspace["tree"]): FileSystemTree {
    const tree: FileSystemTree = {}
    children.forEach((child) => {
      if (child._tag === "File") {
        tree[child.name] = {
          file: { contents: child.initialContent }
        }
      } else {
        tree[child.name] = {
          directory: walk(child.children)
        }
      }
    })
    return tree
  }
  return walk(workspace.tree)
}

const runProgram = `#!/usr/bin/env node
const ChildProcess = require("node:child_process")
const Path = require("node:path")

const outDir = "dist"
const program = process.argv[2]
const programJs = program.replace(/\.ts$/, ".js")
const compiledProgram = Path.join(outDir, Path.basename(programJs))

function run() {
  ChildProcess.spawn("tsc-watch", [
    "--module", "nodenext",
    "--outDir", outDir,
    "--sourceMap", "true",
    "--target", "esnext",
    program,
    "--onSuccess", \`node --enable-source-maps \${compiledProgram}\`
  ], {
    stdio: "inherit"
  }).on("exit", function() {
    console.clear()
    run()
  })
}

run()
`

const devToolsProxy = `#!/usr/bin/env node
const Net = require("node:net")

const server = Net.createServer((socket) => {
  socket.pipe(process.stdout, { end: false })
})

server.listen(34437)
`

const npmRc = `store-dir=.pnpm-store\n`
