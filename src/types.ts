export type PlaceKind = 'town' | 'sight' | 'station' | 'airport' | 'food' | 'stay'
export type Tone = 'good' | 'warn' | 'meh' | 'info'
export type From = 'post' | 'comment' | 'editor'
export type TripKind = 'itinerary' | 'daytrip' | 'pilgrimage' | 'guide' | 'review' | 'question'

export interface Place {
  id: string
  name: string
  ja?: string
  kind: PlaceKind
  area: string
  at: [number, number]
  themes: string[]
  blurb?: string
  approx?: boolean
  offmap?: boolean
}

export interface Area { id: string; name: string; short: string; region: string | null }
export interface Region { id: string; name: string; en: string }

export interface Note { place: string; tone: Tone; text: string; from: From }
export interface Tip { topic: string; text: string; from: From }
export interface PlanDay { day: number; label?: string; title: string; stay?: string; stops: string[]; move?: string }
export interface Rating { place: string; score: number; label: string }

/** 交通方式。市电、地铁、缆车只在建议路线的每日交通里用 */
export type TransitMode = 'jr' | 'bus' | 'shuttle' | 'car' | 'charter' | 'tour' | 'flight' | 'taxi' | 'tram' | 'subway' | 'ropeway'
export interface LegNote { tone: Tone; text: string; from: From }
/** 两个区域之间怎么走：一种方案（mode + how），或者只是对这段路的经验（notes） */
export interface Leg {
  /** 两个区域的 id，按行进方向 */
  between: [string, string]
  day?: number
  mode?: TransitMode[]
  how?: string
  time?: string
  cost?: string
  /** 方案出自哪里，默认 post */
  from?: From
  notes?: LegNote[]
}

export interface TripAnno {
  kind: TripKind
  summary: string
  days?: number
  when?: string
  season?: string
  bases: string[]
  in?: string
  out?: string
  style?: string[]
  budget?: string
  partial?: string
  commercial?: boolean
  plan?: PlanDay[]
  photos?: { place: string; img: number[] }[]
  notes?: Note[]
  tips?: Tip[]
  ratings?: Rating[]
  legs?: Leg[]
}

export interface Source {
  title: string
  author: string
  publishTime: string
  /** 拿不到的计数是 null（例如刚发的帖子评论数） */
  counts: { liked: number; collected: number; comment: number | null; share: number | null }
  url: string
  tags: string[]
  images: { w: number; h: number; live: boolean }[]
  fetchedAt: string | null
}

export interface Segment { day: number; ids: string[] }

export interface Trip extends TripAnno {
  id: string
  src: Source
  /** 行程路线经过（stops + stay）的地点，按顺序去重 */
  route: string[]
  segments: Segment[]
  /** 所有提到的地点：路线 + 经验 + 照片 + 评分 */
  mentions: Set<string>
  areas: Set<string>
  regions: Set<string>
  /** 每张图片（1 起）对应的地点 */
  photoPlace: Map<number, string>
}

export interface PlaceVisit { trip: string; days: number[]; role: 'route' | 'mention' }
export interface PlaceNote extends Note { trip: string }

export interface TripLeg extends Leg { trip: string }

/** 城际图层的一条边：两个区域之间，所有帖子写过的方案和经验 */
export interface EdgeAgg {
  key: string
  /** 按 id 排序后的两个区域 */
  a: string
  b: string
  legs: TripLeg[]
  trips: string[]
}

export interface PlaceAgg {
  place: Place
  visits: PlaceVisit[]
  notes: PlaceNote[]
  photos: { trip: string; img: number }[]
  ratings: (Rating & { trip: string })[]
}

// —— 建议路线（atlas/plans/*.json）：综合帖子和评论排出的逐日行程，带应变分支 ——

export type SgSlot = 'am' | 'pm' | 'eve'
/** 分支在什么情况下启用：暴雪停运 / 阴天 / 没有雪 / 放晴 / 补前几天落下的 */
export type AltKind = 'snow' | 'cloud' | 'nosnow' | 'sunny' | 'makeup'

/** 帖子以外的出处：官网、时刻表等，写明查阅日期 */
export interface SgLink { name: string; url: string; date: string }

/** 已经订好的（机票、酒店、餐厅）或者正在订的；不写姓名、订单号、票号 */
export interface SgBooking {
  status: 'booked' | 'pending'
  what: string
  note?: string
  /** 免费取消截止（当地时间），「YYYY-MM-DD HH:mm」 */
  free?: string
}

/** 一天里一段主要的非步行交通：侧栏悬停时在地图上高亮，按钮跳到谷歌地图 */
export interface SgRide {
  from: string
  to: string
  mode: TransitMode
  /** 「8:30 → 9:05」「约 35 分钟」 */
  time?: string
  /** 坐什么、在哪上车、多少钱 */
  what: string
}

/** 出发前要办的事。mail 是要发邮件或表单问清楚的，带要问的事和日文草稿 */
export interface SgTodo {
  id: string
  kind: 'mail' | 'task'
  title: string
  /** 最晚什么时候办，YYYY-MM-DD；不写就是尽早 */
  by?: string
  /** 和哪一天有关 */
  day?: number
  text?: string
  /** 联系方式：表单、官网 */
  links?: { name: string; url: string }[]
  /** 联系电话（酒店公开的号码） */
  tel?: string
  /** 要问清楚的事 */
  ask?: string[]
  /** 日文草稿；〈 〉里的自己填 */
  draft?: string
}

export interface SgAlt {
  kind: AltKind
  /** 触发条件，例如「有云雾，或者大风缆车停运」 */
  if: string
  /** 时间轴上的短标签 */
  short: string
  title: string
  /** 分支从哪个地点出发；不写就从这个时段之前最后经过的地点出发 */
  from?: string
  stops: string[]
  text: string
  /** 出处：帖子 ID（前 8 位即可） */
  refs?: string[]
  links?: SgLink[]
}

export interface SgSlotItem {
  slot: SgSlot
  time?: string
  short: string
  title: string
  stops: string[]
  /** 这一段怎么去 */
  via?: string
  text: string
  refs?: string[]
  links?: SgLink[]
  booking?: SgBooking
  alts?: SgAlt[]
}

export interface SgMove {
  between: [string, string]
  mode: TransitMode[]
  time?: string
  how: string
  refs?: string[]
  links?: SgLink[]
  booking?: SgBooking
}

export interface SgDay {
  day: number
  /** 日期，YYYY-MM-DD */
  date?: string
  title: string
  /** 时间轴上的短标签，一般是当晚住的城市 */
  short: string
  /** 当晚住的地点；最后一天没有 */
  stay?: string
  stayNote?: string
  stayRefs?: string[]
  stayLinks?: SgLink[]
  stayBooking?: SgBooking
  move?: SgMove
  /** 这一天主要的非步行交通，按顺序 */
  rides?: SgRide[]
  slots: SgSlotItem[]
  /** 影响整天的分支：选中后换掉这一天所有时段 */
  alts?: SgAlt[]
}

export interface SgRule { text: string; refs?: string[]; links?: SgLink[] }

export interface SgPlan {
  id: string
  title: string
  summary: string
  when?: string
  in: string
  out: string
  /** 用户回答过的偏好，问题 → 回答 */
  prefs: { q: string; a: string }[]
  /** 不针对某一天的应变规则，按主题分组 */
  rules: { title: string; kind: string; items: SgRule[] }[]
  days: SgDay[]
  /** 出发前要办的事（预订窗口里显示，勾选状态只存在本机） */
  todos?: SgTodo[]
}
