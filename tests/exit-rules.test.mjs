import { describe, it, expect } from 'vitest';
import { evaluateExit } from '../scripts/lib/exit-rules.mjs';

describe('evaluateExit', () => {
  it('gate 1 catastrophe fires when close < avgCost * 0.90', () => {
    const r = evaluateExit({ close: 89, avgCost: 100, peak: 100, isBear: false, holdingDays: 30 });
    expect(r).toEqual({ fire: true, reason: 'catastrophe' });
  });
  it('gate 2 trailing fires when close < peak * 0.85', () => {
    const r = evaluateExit({ close: 84, avgCost: 100, peak: 100, isBear: false, holdingDays: 30 });
    expect(r).toEqual({ fire: true, reason: 'trailing' });
  });
  it('gate 3 tight-trailing fires when gain >= 0.20 and close < peak * 0.96', () => {
    const r = evaluateExit({ close: 124, avgCost: 100, peak: 130, isBear: false, holdingDays: 30 });
    expect(r).toEqual({ fire: true, reason: 'trailing-tight' });
  });
  it('gate 3 supersedes gate 2 when both could fire', () => {
    const r = evaluateExit({ close: 119, avgCost: 100, peak: 130, isBear: false, holdingDays: 30 });
    expect(r.reason).toBe('trailing-tight');
  });
  it('gate 4 bear-flip fires when isBear', () => {
    const r = evaluateExit({ close: 100, avgCost: 100, peak: 100, isBear: true, holdingDays: 30 });
    expect(r).toEqual({ fire: true, reason: 'bear-flip' });
  });
  it('time-stop disabled — long holds do not auto-exit (tuning F)', () => {
    const r = evaluateExit({ close: 100, avgCost: 100, peak: 100, isBear: false, holdingDays: 9999 });
    expect(r).toEqual({ fire: false, reason: null });
  });
  it('gate 1 supersedes gate 4 when both apply', () => {
    const r = evaluateExit({ close: 80, avgCost: 100, peak: 100, isBear: true, holdingDays: 30 });
    expect(r.reason).toBe('catastrophe');
  });
  it('no fire when nothing breached', () => {
    const r = evaluateExit({ close: 95, avgCost: 100, peak: 100, isBear: false, holdingDays: 30 });
    expect(r).toEqual({ fire: false, reason: null });
  });
});
