import { useEffect, useState } from 'react'

export type ThemeName = 'light' | 'dark'

/** 地图配色。对比色经过 dataviz 校验（all-pairs，CVD ΔE ≥ 8.6，正常视觉 ΔE ≥ 15）。 */
export interface MapPalette {
  land: string
  water: string
  waterLine: string
  wood: string
  road: string
  rail: string
  building: string
  label: string
  labelHalo: string
  waterLabel: string
  ink: string
  muted: string
  ring: string
  accent: string
  accentSoft: string
  corridor: string
  compare: [string, string, string]
  /** 建议路线的主线和分支。和对比色共用两种，已用 dataviz 校验（CVD ΔE ≥ 19） */
  plan: string
  planAlt: string
}

export const PALETTES: Record<ThemeName, MapPalette> = {
  light: {
    land: '#f6f8f9',
    water: '#d6e1e9',
    waterLine: '#c4d3de',
    wood: '#eef2f3',
    road: '#e4e9ed',
    rail: '#a4b0ba',
    building: '#e9edf0',
    label: '#7d8b97',
    labelHalo: '#f6f8f9',
    waterLabel: '#8ea2b3',
    ink: '#1c2833',
    muted: '#9aa7b2',
    ring: '#f6f8f9',
    accent: '#2c5d8f',
    accentSoft: '#7fa3c7',
    corridor: '#1c2833',
    compare: ['#e0543f', '#3f7fc4', '#1f9c80'],
    plan: '#3f7fc4',
    planAlt: '#e0543f',
  },
  dark: {
    land: '#16212b',
    water: '#0d151d',
    waterLine: '#1b2a37',
    wood: '#18242f',
    road: '#1e2b37',
    rail: '#3d4f60',
    building: '#1c2833',
    label: '#6f8293',
    labelHalo: '#16212b',
    waterLabel: '#4d6275',
    ink: '#dfe7ee',
    muted: '#5d7083',
    ring: '#16212b',
    accent: '#8fb7e0',
    accentSoft: '#4f7397',
    corridor: '#c9d6e2',
    compare: ['#df6a52', '#5b93d8', '#31a689'],
    plan: '#5b93d8',
    planAlt: '#df6a52',
  },
}

export type ThemePref = 'auto' | ThemeName

function systemTheme(): ThemeName {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(() => {
    try {
      const t = localStorage.getItem('hk.theme')
      return t === 'light' || t === 'dark' ? t : 'auto'
    } catch {
      return 'auto'
    }
  })
  const [sys, setSys] = useState<ThemeName>(systemTheme)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const on = () => setSys(mq.matches ? 'dark' : 'light')
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  useEffect(() => {
    const root = document.documentElement
    if (pref === 'auto') delete root.dataset.theme
    else root.dataset.theme = pref
    try {
      if (pref === 'auto') localStorage.removeItem('hk.theme')
      else localStorage.setItem('hk.theme', pref)
    } catch {
      /* 隐私模式下忽略 */
    }
  }, [pref])

  const theme: ThemeName = pref === 'auto' ? sys : pref
  const toggle = () => setPref(theme === 'dark' ? 'light' : 'dark')
  return { theme, toggle }
}
