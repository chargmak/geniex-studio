/**
 * Model auto-selection lives in `@shared` so the renderer picks the same model the server would:
 * the composer needs to *show* the model before the turn is sent, and a UI-side "just take the first
 * installed model" fallback would silently defeat the crash avoidance below.
 */
export { crashCount, crashRecordFor, pickAutoModel, type AutoPickOptions, type CrashRecord } from '@shared/modelSelect'
