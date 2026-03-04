/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { env } from 'node:process';

// This test verifies that 'codex-ilhae' natively supports ACP protocol
// when running in a2a-server mode.
describe('Codex Native ACP E2E', () => {
  let serverProcess: ChildProcess | undefined;
  const PORT = 41245; // Use a dedicated port for testing
  const CODEX_BIN = join(process.cwd(), 'codex/codex-rs/target/debug/codex-ilhae');

  beforeAll(async () => {
    // Start codex-ilhae in A2A server mode
    serverProcess = spawn(CODEX_BIN, ['a2a-server', '--port', PORT.toString()], {
      env: { ...process.env, VERBOSE: 'true' },
      stdio: 'inherit'
    });

    // Wait for the server to start (simple sleep for E2E)
    await new Promise(resolve => setTimeout(resolve, 2000));
  });

  afterAll(() => {
    serverProcess?.kill();
  });

  async function acpRequest(method: string, params: any) {
    const response = await fetch(`http://localhost:${PORT}/acp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'test-1',
        method,
        params
      })
    });
    return response.json();
  }

  it('should initialize and return protocol version', async () => {
    const res = await acpRequest('initialize', {
      protocolVersion: '0.1.0',
      clientInfo: { name: 'test-client', version: '1.0.0' }
    });
    expect(res.result.protocolVersion).toBe('0.1.0');
    expect(res.result.serverInfo.name).toBe('codex-a2a');
  });

  it('should create a new session', async () => {
    const res = await acpRequest('session/new', { cwd: '/' });
    expect(res.result.sessionId).toBeDefined();
    expect(res.result.agentInfo.name).toBe('codex');
  });

  it('should handle message/send (non-streaming)', async () => {
    const { result: { sessionId } } = await acpRequest('session/new', { cwd: '/' });
    
    // Send a message and wait for completion
    const res = await acpRequest('message/send', {
      sessionId,
      message: { text: 'echo Hello from test' }
    });
    
    expect(res.result.message.text).toBeDefined();
    // Codex normally outputs text; we verify it's not empty
    expect(res.result.message.text.length).toBeGreaterThan(0);
  }, 10000); // 10s timeout for codex execution

  it('should handle message/stream (streaming)', async () => {
    const { result: { sessionId } } = await acpRequest('session/new', { cwd: '/' });
    
    // Start streaming
    const res = await acpRequest('message/stream', {
      sessionId,
      message: { text: 'echo Stream test' }
    });
    
    expect(res.result.streaming).toBe(true);
    
    // In a real test we would connect via WebSocket or check the broadcaster,
    // but here we just verify the initial handshake succeeds.
  });
});
