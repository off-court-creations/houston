import { describe, it, expect, beforeEach } from 'vitest';
import { recordChange, getChangeTypes, clearChangeTypes } from '../../src/services/mutation-tracker.js';

describe('mutation-tracker', () => {
  beforeEach(() => clearChangeTypes());

  it('records and returns sorted change types', () => {
    recordChange('labels');
    recordChange('tickets');
    recordChange('backlog');
    recordChange('tickets'); // duplicate
    const types = getChangeTypes();
    expect(types).toEqual(['backlog', 'labels', 'tickets']);
  });

  it('clears recorded types', () => {
    recordChange('people');
    clearChangeTypes();
    expect(getChangeTypes()).toEqual([]);
  });
});

