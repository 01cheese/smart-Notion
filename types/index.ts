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

export type FontFamily =
  | 'serif'
  | 'sans'
  | 'mono'
  | 'display'
  | 'news'
  | 'literata'
  | 'source'

export type VoiceLanguage = 'en-US' | 'ru-RU' | 'pl-PL'

export interface UISettings {
  font: FontFamily
  theme: Theme
  font_size: number
  width: number
  gemini_key: string
  gemini_model: string
  /** Show chips when typing !!… */
  command_suggestions: boolean
  /** Show shortcut strip while editing */
  keyboard_hints: boolean
  /** Mic button for speech-to-text */
  voice_input_enabled: boolean
  /** Speech recognition language */
  voice_language: VoiceLanguage
}

export type AIAction = 'continue' | 'explain' | 'replace' | 'beautify'
