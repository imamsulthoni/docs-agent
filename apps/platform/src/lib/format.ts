/**
 * Human-readable storage size for the dashboard quota panel. Uses GB once the
 * value reaches 1 GB so a 1 GB quota reads as "1.0 GB", not "1024.0 MB".
 */
export function formatStorageBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${Math.round(bytes)} B`
}
