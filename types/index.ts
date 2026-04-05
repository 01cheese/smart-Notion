export interface Note {
  id: string
  content_text: string
  updated_at: string
}

export interface UserSettings {
  user_id: string
  gemini_key: string
  gemini_model: string
}

export type Theme = 'light' | 'dark' | 'sepia' | 'midnight'
export type FontFamily = 'serif' | 'sans' | 'mono'

export interface UISettings {
  font: FontFamily
  theme: Theme
  font_size: number
  width: number
  gemini_key: string
  gemini_model: string
}

export type AIAction = 'continue' | 'explain' | 'replace'
