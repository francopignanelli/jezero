import { z } from 'zod';

/**
 * Runtime contracts shared by the web client and the API. Every persisted record carries
 * `schemaVersion`; bump it and add a migrator when a shape changes (see docs/PLAN.md §5.6).
 */

// ---------- primitives ----------

/** Removes C0/C1 control characters and normalizes to NFC before length checks. */
const cleanText = (max: number) =>
  z
    .string()
    // eslint-disable-next-line no-control-regex -- intentionally strips control characters from user text
    .transform((s) => s.normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim())
    .pipe(z.string().min(1).max(max));

export const MissionName = cleanText(80);
export const Latitude = z.number().finite().min(-90).max(90);
/** East longitude, storage convention [0, 360). */
export const LongitudeEast = z.number().finite().min(0).lt(360);
const Id = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, 'ULID');
const IsoUtc = z.iso.datetime({ offset: false });

// ---------- missions ----------

export const Waypoint = z.object({
  lat: Latitude,
  lon: LongitudeEast,
  label: cleanText(80).optional(),
  poiId: z.string().regex(/^[a-z0-9-]{1,64}$/).optional(),
});

export const RouteParameters = z.object({
  profile: z.enum(['lower-risk', 'shortest']),
  returnToStart: z.boolean(),
});

export const RouteMetricsSummary = z.object({
  horizontalDistanceM: z.number().finite().nonnegative(),
  distance3dM: z.number().finite().nonnegative(),
  elevationGainM: z.number().finite().nonnegative(),
  elevationLossM: z.number().finite().nonnegative(),
  maxTerrainSlopeDeg: z.number().finite().min(0).max(90),
  estimatedDurationS: z.number().finite().nonnegative(),
  walkbackOk: z.boolean(),
});

export const ExplanationFact = z
  .object({ code: z.string().regex(/^[A-Z_]{3,40}$/) })
  .catchall(z.union([z.number().finite(), z.string().max(120), z.boolean(), z.object({ lat: Latitude, lon: LongitudeEast })]));

/** Route geometry as [lat, lon, elevationM] triples; bounded to keep items well under 400 KB. */
export const RouteGeometry = z.array(z.tuple([Latitude, LongitudeEast, z.number().finite()])).min(2).max(5000);

export const StoredRoute = z.object({
  metrics: RouteMetricsSummary,
  explanation: z.array(ExplanationFact).max(24),
  geometry: RouteGeometry,
});

export const MissionInput = z.object({
  name: MissionName,
  region: z.literal('jezero'),
  waypoints: z.array(Waypoint).min(2).max(20),
  parameters: RouteParameters,
  evaStartUtc: IsoUtc,
  route: StoredRoute.nullable(),
  datasetVersion: z.string().min(1).max(80),
  algorithmVersion: z.string().min(1).max(80),
  parameterSet: z.string().min(1).max(80),
  notes: cleanText(2000).optional(),
});
export type MissionInput = z.infer<typeof MissionInput>;

export const MissionPatch = MissionInput.partial().refine((p) => Object.keys(p).length > 0, 'empty patch');
export type MissionPatch = z.infer<typeof MissionPatch>;

export const Mission = MissionInput.extend({
  schemaVersion: z.literal(1),
  id: Id,
  version: z.number().int().positive(),
  createdAt: IsoUtc,
  updatedAt: IsoUtc,
});
export type Mission = z.infer<typeof Mission>;

export const MissionSummary = Mission.pick({
  id: true,
  name: true,
  region: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  datasetVersion: true,
  algorithmVersion: true,
}).extend({ distanceM: z.number().nullable(), durationS: z.number().nullable() });
export type MissionSummary = z.infer<typeof MissionSummary>;

// ---------- profile ----------

export const ProfilePatch = z.object({
  locale: z.enum(['en', 'es']).optional(),
  favoritePoiIds: z.array(z.string().regex(/^[a-z0-9-]{1,64}$/)).max(200).optional(),
  preferences: z.object({ reducedMotion: z.boolean().optional() }).optional(),
  /** Explicit self-attestation required by the Gemini API terms before AI use. */
  aiAttested18: z.literal(true).optional(),
});
export type ProfilePatch = z.infer<typeof ProfilePatch>;

export const Profile = z.object({
  schemaVersion: z.literal(1),
  version: z.number().int().positive(),
  locale: z.enum(['en', 'es']),
  favoritePoiIds: z.array(z.string()).max(200),
  preferences: z.object({ reducedMotion: z.boolean().optional() }),
  aiAttested18At: IsoUtc.nullable(),
  emailVerified: z.boolean(),
});
export type Profile = z.infer<typeof Profile>;

// ---------- registration ----------

export const Registration = z.object({
  email: z.email().max(254).transform((e) => e.toLowerCase()),
  password: z.string().min(12).max(128),
  captchaToken: z.string().min(1).max(4096),
  inviteCode: z.string().max(64).optional(),
});
export type Registration = z.infer<typeof Registration>;

// ---------- assistant ----------

/** Structured app context sent with a question. Treated as untrusted data by the server. */
export const AssistantContext = z.object({
  locale: z.enum(['en', 'es']),
  view: z.enum(['orbit', 'jezero']),
  activeLayers: z.array(z.string().regex(/^[a-zA-Z]{2,32}$/)).max(16),
  selectedPoiId: z.string().regex(/^[a-z0-9-]{1,64}$/).nullable(),
  route: z
    .object({
      profile: z.enum(['lower-risk', 'shortest']),
      waypointCount: z.number().int().min(2).max(21),
      lowerRisk: RouteMetricsSummary.nullable(),
      shortest: RouteMetricsSummary.nullable(),
      explanation: z.array(ExplanationFact).max(24),
    })
    .nullable(),
  environment: z
    .object({
      sol: z.number().int().min(0).max(100000),
      lsDeg: z.number().min(0).lt(360),
      ltstHours: z.number().min(0).lt(24),
      latestMedaSol: z.number().int().nullable(),
    })
    .nullable(),
});
export type AssistantContext = z.infer<typeof AssistantContext>;

export const AssistantRequest = z.object({
  message: cleanText(600),
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(1200) }))
    .max(4),
  context: AssistantContext,
});
export type AssistantRequest = z.infer<typeof AssistantRequest>;

/** Actions the assistant may PROPOSE; the client validates IDs and the user confirms saves. */
export const AssistantAction = z.discriminatedUnion('type', [
  z.object({ type: z.literal('fly_to_poi'), poiId: z.string().regex(/^[a-z0-9-]{1,64}$/) }),
  z.object({ type: z.literal('toggle_layer'), layerId: z.string().regex(/^[a-zA-Z]{2,32}$/), visible: z.boolean() }),
  z.object({ type: z.literal('show_alternative'), profile: z.enum(['lower-risk', 'shortest']) }),
  z.object({ type: z.literal('propose_save_mission'), name: MissionName }),
]);
export type AssistantAction = z.infer<typeof AssistantAction>;

export const AssistantResponse = z.object({
  text: z.string().max(4000),
  actions: z.array(AssistantAction).max(3),
  truncated: z.boolean(),
  quota: z.object({ userRemainingToday: z.number().int().min(0), globalAvailable: z.boolean() }),
  handledLocally: z.boolean(),
});
export type AssistantResponse = z.infer<typeof AssistantResponse>;

// ---------- errors (RFC 9457 problem details) ----------

export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHORIZED',
  'NOT_FOUND',
  'VERSION_CONFLICT',
  'LIMIT_REACHED',
  'PAYLOAD_TOO_LARGE',
  'QUOTA_USER_DAILY',
  'QUOTA_GLOBAL',
  'AI_DISABLED',
  'AI_UNAVAILABLE',
  'AI_BUSY',
  'AI_ATTESTATION_REQUIRED',
  'REGISTRATION_CLOSED',
  'CAPTCHA_FAILED',
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const Problem = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  code: z.enum(ERROR_CODES),
  detail: z.string().optional(),
});
export type Problem = z.infer<typeof Problem>;
