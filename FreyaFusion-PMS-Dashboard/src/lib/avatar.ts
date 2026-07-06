// Inline SVG placeholder so avatars always render — even fully offline or if the
// external avatar bucket is unreachable during a demo/review.
export const FALLBACK_AVATAR =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80'%3E%3Crect width='80' height='80' fill='%23e6eefa'/%3E%3Ccircle cx='40' cy='32' r='14' fill='%23a9bacd'/%3E%3Cpath d='M14 72c0-14 12-22 26-22s26 8 26 22z' fill='%23a9bacd'/%3E%3C/svg%3E";
