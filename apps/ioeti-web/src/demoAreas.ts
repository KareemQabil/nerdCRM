export const DEMO_AREAS = [
  "quotes","catalog","contracts","finance","projects","visits",
  "quality","marketing","learning","recruiting","certification","fundraising",
  "documents","automations","reports","admin"
] as const;
export type DemoArea = typeof DEMO_AREAS[number];
