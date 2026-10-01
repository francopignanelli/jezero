import { describe, expect, it } from 'vitest';
import { AssistantAction, AssistantRequest, MissionInput, MissionName, Registration } from './index';

const valid = {
  name: '  Delta front  walk ',
  region: 'jezero',
  waypoints: [
    { lat: 18.44457, lon: 77.45091, label: 'Landing' },
    { lat: 18.45296, lon: 77.40821, poiId: 'three-forks' },
  ],
  parameters: { profile: 'lower-risk', returnToStart: true },
  evaStartUtc: '2026-09-26T14:00:00Z',
  route: null,
  datasetVersion: 'jezero-v1',
  algorithmVersion: 'route@0.1.0',
  parameterSet: 'eva-params@1#756b4c54',
};

describe('mission contract', () => {
  it('accepts a valid mission and normalizes the name', () => {
    const m = MissionInput.parse(valid);
    expect(m.name).toBe('Delta front  walk');
  });

  it('strips control characters and rejects empty or oversized names', () => {
    expect(MissionName.parse('Jez\u0000ero\u0007')).toBe('Jezero');
    expect(() => MissionName.parse('\u0000\u0001')).toThrow();
    expect(() => MissionName.parse('x'.repeat(81))).toThrow();
  });

  it('rejects out-of-range coordinates, west longitudes and too many waypoints', () => {
    expect(() => MissionInput.parse({ ...valid, waypoints: [{ lat: 91, lon: 77 }, valid.waypoints[1]] })).toThrow();
    expect(() => MissionInput.parse({ ...valid, waypoints: [{ lat: 18, lon: -77 }, valid.waypoints[1]] })).toThrow();
    expect(() => MissionInput.parse({ ...valid, waypoints: Array(21).fill(valid.waypoints[0]) })).toThrow();
  });

  it('rejects unknown regions and oversized geometry', () => {
    expect(() => MissionInput.parse({ ...valid, region: 'gale' })).toThrow();
    const geometry = Array.from({ length: 5001 }, () => [18.4, 77.4, -2500]);
    expect(() =>
      MissionInput.parse({
        ...valid,
        route: {
          metrics: { horizontalDistanceM: 1, distance3dM: 1, elevationGainM: 0, elevationLossM: 0, maxTerrainSlopeDeg: 1, estimatedDurationS: 1, walkbackOk: true },
          explanation: [],
          geometry,
        },
      }),
    ).toThrow();
  });
});

describe('assistant contracts', () => {
  it('bounds message and history', () => {
    const base = {
      message: 'Why is this route longer?',
      history: [],
      context: { locale: 'en', view: 'jezero', activeLayers: ['slope'], selectedPoiId: null, route: null, environment: null },
    };
    expect(AssistantRequest.parse(base).message).toBe('Why is this route longer?');
    expect(() => AssistantRequest.parse({ ...base, message: 'x'.repeat(601) })).toThrow();
    expect(() => AssistantRequest.parse({ ...base, history: Array(5).fill({ role: 'user', text: 'hi' }) })).toThrow();
    expect(() => AssistantRequest.parse({ ...base, context: { ...base.context, activeLayers: ['<script>'] } })).toThrow();
  });

  it('only allows allowlisted action shapes', () => {
    expect(AssistantAction.parse({ type: 'fly_to_poi', poiId: 'three-forks' }).type).toBe('fly_to_poi');
    expect(() => AssistantAction.parse({ type: 'delete_mission', id: 'x' })).toThrow();
    expect(() => AssistantAction.parse({ type: 'fly_to_poi', poiId: 'https://evil.example' })).toThrow();
  });
});

describe('registration contract', () => {
  it('requires a strong-enough password and lowercases email', () => {
    expect(Registration.parse({ email: 'Crew@Example.org', password: 'correct horse battery', captchaToken: 't' }).email).toBe('crew@example.org');
    expect(() => Registration.parse({ email: 'crew@example.org', password: 'short', captchaToken: 't' })).toThrow();
  });
});
