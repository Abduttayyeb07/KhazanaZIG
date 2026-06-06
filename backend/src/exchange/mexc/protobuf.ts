import protobuf from "protobufjs";

// ── MEXC PushDataV3ApiWrapper decoder ──────────────────────────────────────────
//
// MEXC migrated its v3 WebSocket to Protobuf serialization (Aug 2025).
// Source proto definitions: https://github.com/mexcdevelop/websocket-proto
//
// We embed a minimal self-contained proto with ONLY the messages we subscribe to:
//   - PublicAggreDepthsV3Api (field 313 in the wrapper oneof)
//   - PublicAggreDealsV3Api  (field 314 in the wrapper oneof)
//
// Other oneof bodies are omitted — protobuf skips unknown fields, and we never
// subscribe to those channels, so they will never arrive.
// ──────────────────────────────────────────────────────────────────────────────

const PROTO_DEFINITION = `
syntax = "proto3";

message PublicAggreDepthV3ApiItem {
  string price = 1;
  string quantity = 2;
}

message PublicAggreDepthsV3Api {
  repeated PublicAggreDepthV3ApiItem asks = 1;
  repeated PublicAggreDepthV3ApiItem bids = 2;
  string eventType = 3;
  string fromVersion = 4;
  string toVersion = 5;
}

message PublicAggreDealsV3ApiItem {
  string price = 1;
  string quantity = 2;
  int32 tradeType = 3;
  int64 time = 4;
}

message PublicAggreDealsV3Api {
  repeated PublicAggreDealsV3ApiItem deals = 1;
  string eventType = 2;
}

message PushDataV3ApiWrapper {
  string channel = 1;
  oneof body {
    PublicAggreDepthsV3Api publicAggreDepths = 313;
    PublicAggreDealsV3Api publicAggreDeals = 314;
  }
  optional string symbol = 3;
  optional string symbolId = 4;
  optional int64 createTime = 5;
  optional int64 sendTime = 6;
}
`;

export interface DepthLevel {
  price: string;
  quantity: string;
}

export interface DecodedDepth {
  kind: "depth";
  channel: string;
  symbol: string | null;
  asks: DepthLevel[];
  bids: DepthLevel[];
  fromVersion: string;
  toVersion: string;
}

export interface DecodedDeal {
  kind: "deals";
  channel: string;
  symbol: string | null;
  deals: Array<{ price: string; quantity: string; tradeType: number; time: number }>;
}

export type DecodedMessage = DecodedDepth | DecodedDeal | null;

interface WrapperMessage {
  channel: string;
  symbol?: string;
  publicAggreDepths?: {
    asks: DepthLevel[];
    bids: DepthLevel[];
    fromVersion: string;
    toVersion: string;
  };
  publicAggreDeals?: {
    deals: Array<{ price: string; quantity: string; tradeType: number; time: number | Long }>;
  };
}

// protobufjs represents int64 as a Long object unless configured otherwise
type Long = { toNumber(): number };

const root = protobuf.parse(PROTO_DEFINITION).root;
const Wrapper = root.lookupType("PushDataV3ApiWrapper");

export function decodeMexcMessage(buffer: Buffer): DecodedMessage {
  const decoded = Wrapper.decode(buffer);
  const msg = Wrapper.toObject(decoded, {
    longs: Number,
    defaults: true,
    arrays: true,
  }) as WrapperMessage;

  const symbol = msg.symbol ?? null;

  if (msg.publicAggreDepths) {
    return {
      kind: "depth",
      channel: msg.channel,
      symbol,
      asks: msg.publicAggreDepths.asks ?? [],
      bids: msg.publicAggreDepths.bids ?? [],
      fromVersion: msg.publicAggreDepths.fromVersion ?? "",
      toVersion: msg.publicAggreDepths.toVersion ?? "",
    };
  }

  if (msg.publicAggreDeals) {
    return {
      kind: "deals",
      channel: msg.channel,
      symbol,
      deals: (msg.publicAggreDeals.deals ?? []).map((d) => ({
        price: d.price,
        quantity: d.quantity,
        tradeType: d.tradeType,
        time: typeof d.time === "number" ? d.time : d.time.toNumber(),
      })),
    };
  }

  return null;
}
