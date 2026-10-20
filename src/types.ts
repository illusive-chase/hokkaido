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

/** 城际交通方式 */
export type TransitMode = 'jr' | 'bus' | 'shuttle' | 'car' | 'charter' | 'tour' | 'flight' | 'taxi'
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
  alts?: SgAlt[]
}

export interface SgMove {
  between: [string, string]
  mode: TransitMode[]
  time?: string
  how: string
  refs?: string[]
}

export interface SgDay {
  day: number
  title: string
  /** 时间轴上的短标签，一般是当晚住的城市 */
  short: string
  /** 当晚住的地点；最后一天没有 */
  stay?: string
  stayNote?: string
  stayRefs?: string[]
  move?: SgMove
  slots: SgSlotItem[]
  /** 影响整天的分支 */
  alts?: SgAlt[]
}

export interface SgRule { text: string; refs?: string[] }

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
}
