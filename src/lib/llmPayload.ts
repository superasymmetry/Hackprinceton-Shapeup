import { UserHeadProfile } from '@/types';

export function buildCurrentProfilePayload(profile: UserHeadProfile) {
  return {
    headProportions: profile.headProportions,
    hairMeasurements: profile.hairMeasurements,
    measurementSnapshot: profile.measurementSnapshot ?? null,
    currentStyle: profile.currentStyle,
  };
}
