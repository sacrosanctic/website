import React from "react"
import { AlertIcon } from "./alert"
import { AlgoliaIcon } from "./algolia"
import { AmazonIcon } from "./amazon"
import { ArrowDownIcon } from "./arrow-down"
import { ArrowRightIcon } from "./arrow-right"
import { ArrowUpRightIcon } from "./arrow-up-right"
import { ArrowUpRightLightIcon } from "./arrow-up-right-light"
import { ArrowsUpDownIcon } from "./arrows-up-down"
import { BarsIcon } from "./bars"
import { BlocksIcon } from "./blocks"
import { BunIcon } from "./bun"
import { CheckIcon } from "./check"
import { CheckCircleIcon } from "./check-circle"
import { ChevronDownIcon } from "./chevron-down"
import { ChevronRightIcon } from "./chevron-right"
import { ClipboardIcon } from "./clipboard"
import { CloseIcon } from "./close"
import { CloudflareIcon } from "./cloudflare"
import { DenoIcon } from "./deno"
import { DirectoryClosedIcon } from "./directory-closed"
import { DirectoryOpenIcon } from "./directory-open"
import { DirectoryPlusIcon } from "./directory-plus"
import { DiscordIcon } from "./discord"
import { DisplayIcon } from "./display"
import { DotSolid } from "./dot-solid"
import { DotsHorizontalIcon } from "./dots-horizontal"
import { DragHandleDotsIcon } from "./drag-handle-dots"
import { EditIcon } from "./edit"
import { ErrorIcon } from "./error"
import { FileIcon } from "./file"
import { FilePlusIcon } from "./file-plus"
import { GearIcon } from "./gear"
import { GitHubIcon } from "./github"
import { GraphQLIcon } from "./graphql"
import { InfoIcon } from "./info"
import { LightbulbIcon } from "./lightbulb"
import { LightbulbSolidIcon } from "./lightbulb-solid"
import { LoadingIcon } from "./loading"
import { MixerHorizontalIcon } from "./mixer-horizontal"
import { MoonIcon } from "./moon"
import { NextIcon } from "./next"
import { NodeIcon } from "./node"
import { OpenAPIIcon } from "./open-api"
import { PlayIcon } from "./play"
import { PlugsIcon } from "./plugs"
import { PlusIcon } from "./plus"
import { QuestionCircleIcon } from "./question-circle"
import { ReactIcon } from "./react"
import { SearchIcon } from "./search"
import { ShieldIcon } from "./shield"
import { SunIcon } from "./sun"
import { TrashIcon } from "./trash"
import { TrendUpIcon } from "./trend-up"
import { TwitterIcon } from "./twitter"

const icons = {
  alert: AlertIcon,
  algolia: AlgoliaIcon,
  amazon: AmazonIcon,
  "arrow-down": ArrowDownIcon,
  "arrow-right": ArrowRightIcon,
  "arrow-up-right": ArrowUpRightIcon,
  "arrow-up-right-light": ArrowUpRightLightIcon,
  "arrows-up-down": ArrowsUpDownIcon,
  bars: BarsIcon,
  blocks: BlocksIcon,
  bun: BunIcon,
  check: CheckIcon,
  "check-circle": CheckCircleIcon,
  "chevron-right": ChevronRightIcon,
  "chevron-down": ChevronDownIcon,
  clipboard: ClipboardIcon,
  close: CloseIcon,
  cloudflare: CloudflareIcon,
  deno: DenoIcon,
  "directory-closed": DirectoryClosedIcon,
  "directory-open": DirectoryOpenIcon,
  "directory-plus": DirectoryPlusIcon,
  discord: DiscordIcon,
  display: DisplayIcon,
  "dot-solid": DotSolid,
  "dots-horizontal": DotsHorizontalIcon,
  "drag-handle-dots": DragHandleDotsIcon,
  edit: EditIcon,
  error: ErrorIcon,
  file: FileIcon,
  "file-plus": FilePlusIcon,
  gear: GearIcon,
  github: GitHubIcon,
  graphql: GraphQLIcon,
  info: InfoIcon,
  lightbulb: LightbulbIcon,
  "lightbulb-solid": LightbulbSolidIcon,
  loading: LoadingIcon,
  "mixer-horizontal": MixerHorizontalIcon,
  moon: MoonIcon,
  next: NextIcon,
  node: NodeIcon,
  "open-api": OpenAPIIcon,
  play: PlayIcon,
  plugs: PlugsIcon,
  plus: PlusIcon,
  "question-circle": QuestionCircleIcon,
  react: ReactIcon,
  search: SearchIcon,
  shield: ShieldIcon,
  sun: SunIcon,
  trash: TrashIcon,
  "trend-up": TrendUpIcon,
  twitter: TwitterIcon
}

export declare namespace Icon {
  export interface Props extends CommonProps {
    readonly name: Name
  }

  export interface CommonProps {
    readonly className?: string
  }

  export type Name = keyof typeof icons
}

export const Icon: React.FC<Icon.Props> = ({ name, className }) => {
  const IconComponent = icons[name]
  return <IconComponent className={className} />
}

Icon.displayName = "Icon"
