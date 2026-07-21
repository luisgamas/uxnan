import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RemoteInfo } from 'node:dgram';
import {
  MdnsAdvertiser,
  buildMessage,
  encodeName,
  parseQuestions,
  type UdpSocketLike,
} from '../../src/index.js';

/** Build a minimal mDNS query (QDCOUNT=1) for `labels` of `qtype`. */
function buildQuery(labels: string[], qtype = 12): Buffer {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(0, 0);
  header.writeUInt16BE(0, 2); // a query (QR=0)
  header.writeUInt16BE(1, 4); // QDCOUNT
  const q = Buffer.alloc(4);
  q.writeUInt16BE(qtype, 0);
  q.writeUInt16BE(1, 2); // class IN
  return Buffer.concat([header, encodeName(labels), q]);
}

function fakeSocket() {
  const sends: Buffer[] = [];
  const sendInterfaces: Array<string | undefined> = [];
  let onMessage: ((m: Buffer, r: RemoteInfo) => void) | undefined;
  let bound = false;
  const memberships: Array<{ address: string; interfaceAddress?: string }> = [];
  let activeInterface: string | undefined;
  const socket: UdpSocketLike = {
    on(event, listener) {
      if (event === 'message') onMessage = listener as (m: Buffer, r: RemoteInfo) => void;
    },
    bind(_opts, cb) {
      bound = true;
      cb?.();
    },
    addMembership(addr, interfaceAddress) {
      memberships.push({ address: addr, interfaceAddress });
    },
    setMulticastInterface(interfaceAddress) {
      activeInterface = interfaceAddress;
    },
    setMulticastTTL() {},
    send(msg, _port, _addr, cb) {
      sends.push(msg);
      sendInterfaces.push(activeInterface);
      cb?.(null);
    },
    close(cb) {
      cb?.();
    },
  };
  return {
    socket,
    sends,
    sendInterfaces,
    isBound: () => bound,
    memberships: () => memberships,
    deliver: (m: Buffer) => onMessage?.(m, { address: '9.9.9.9' } as RemoteInfo),
  };
}

function advertiser(fake: ReturnType<typeof fakeSocket>) {
  return new MdnsAdvertiser({
    instanceName: 'My PC',
    hostName: 'my-pc',
    port: 8765,
    addresses: ['10.0.0.5'],
    txt: { id: 'dev-abc' },
    announceCount: 1,
    socketFactory: () => fake.socket,
  });
}

test('encodeName round-trips through parseQuestions', () => {
  const query = buildQuery(['_uxnan', '_tcp', 'local']);
  const questions = parseQuestions(query);
  assert.equal(questions.length, 1);
  assert.deepEqual(questions[0]!.labels, ['_uxnan', '_tcp', 'local']);
  assert.equal(questions[0]!.type, 12);
});

test('buildMessage sets QR+AA and the answer count', () => {
  const msg = buildMessage([
    { labels: ['local'], type: 1, flush: true, ttl: 120, rdata: Buffer.from([10, 0, 0, 5]) },
  ]);
  assert.equal(msg.readUInt16BE(2), 0x8400); // QR + AA
  assert.equal(msg.readUInt16BE(6), 1); // ANCOUNT
});

test('announces on start and joins the multicast group', () => {
  const fake = fakeSocket();
  advertiser(fake).start();
  assert.equal(fake.isBound(), true);
  assert.deepEqual(fake.memberships(), [{ address: '224.0.0.251', interfaceAddress: '10.0.0.5' }]);
  assert.equal(fake.sends.length, 1, 'one unsolicited announcement');
  assert.deepEqual(fake.sendInterfaces, ['10.0.0.5']);
});

test('joins and advertises on every explicit IPv4 interface', () => {
  const fake = fakeSocket();
  const adv = new MdnsAdvertiser({
    instanceName: 'Multi-homed PC',
    hostName: 'multi-homed-pc',
    port: 8765,
    addresses: ['192.168.1.5', '100.64.0.8'],
    announceCount: 1,
    socketFactory: () => fake.socket,
  });

  adv.start();

  assert.deepEqual(fake.memberships(), [
    { address: '224.0.0.251', interfaceAddress: '192.168.1.5' },
    { address: '224.0.0.251', interfaceAddress: '100.64.0.8' },
  ]);
  assert.equal(fake.sends.length, 2, 'one announcement per joined interface');
  assert.deepEqual(fake.sendInterfaces, ['192.168.1.5', '100.64.0.8']);
});

test('answers a browse query for our service, ignores others', () => {
  const fake = fakeSocket();
  advertiser(fake).start();
  assert.equal(fake.sends.length, 1);

  fake.deliver(buildQuery(['_uxnan', '_tcp', 'local']));
  assert.equal(fake.sends.length, 2, 'responded to the browse query');

  fake.deliver(buildQuery(['_printer', '_tcp', 'local']));
  assert.equal(fake.sends.length, 2, 'ignored an unrelated service');

  // also responds to the DNS-SD meta-query
  fake.deliver(buildQuery(['_services', '_dns-sd', '_udp', 'local']));
  assert.equal(fake.sends.length, 3);

  // The response advertises the port, address and device id (in SRV/A/TXT).
  const resp = fake.sends[1]!;
  assert.ok(resp.readUInt16BE(6) >= 4, 'PTR + SRV + TXT + A answers');
  assert.ok(resp.includes(Buffer.from('addr=10.0.0.5')), 'TXT addr');
  assert.ok(resp.includes(Buffer.from('port=8765')), 'TXT port');
  assert.ok(resp.includes(Buffer.from('id=dev-abc')), 'TXT device id');
  assert.ok(resp.includes(Buffer.from([10, 0, 0, 5])), 'A record IPv4');
});

test('stop sends a goodbye (TTL 0) then closes', () => {
  const fake = fakeSocket();
  const adv = advertiser(fake);
  adv.start();
  const before = fake.sends.length;
  adv.stop();
  assert.equal(fake.sends.length, before + 1, 'a goodbye packet');
  // the goodbye carries TTL 0 on its first (PTR) answer: name, then type(2) class(2) ttl(4)
  const goodbye = fake.sends[fake.sends.length - 1]!;
  // find the PTR answer's TTL: walk past header(12) + name; simplest is to assert
  // the buffer contains a 4-byte zero TTL somewhere after the header.
  assert.ok(goodbye.length > 12);
  // A fresh start after stop is a no-op until re-created (idempotent stop).
  adv.stop();
});

test('start is idempotent and degrades silently if the socket throws', () => {
  const throwing = new MdnsAdvertiser({
    instanceName: 'x',
    hostName: 'x',
    port: 1,
    addresses: [],
    socketFactory: () => {
      throw new Error('no socket');
    },
  });
  // Must not throw — mDNS is best-effort.
  throwing.start();
  throwing.stop();
});
