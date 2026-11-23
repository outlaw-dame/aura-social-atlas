import { describe, expect, test } from 'bun:test';
import { bareAcct, serverOf } from '../src/components/social/useServerBlock';

describe('the server part of a handle', () => {
  test('with or without the leading @ profiles show', () => {
    expect(serverOf('@ann@castopod.example.net')).toBe('castopod.example.net');
    expect(serverOf('ann@Castopod.Example.net')).toBe('castopod.example.net');
    expect(bareAcct('@ann@castopod.example.net')).toBe('ann@castopod.example.net');
  });
  test('none for Fedizen itself or a bare name', () => {
    expect(serverOf('@ann@fedizen.net')).toBeNull();
    expect(serverOf('ann')).toBeNull();
    expect(serverOf(undefined)).toBeNull();
  });
});
