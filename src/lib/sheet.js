export const SCHEMA_VERSION = "1.0";

export const ACCESSORIALS = [
  "liftgate_pickup",
  "liftgate_delivery",
  "inside_pickup",
  "inside_delivery",
  "residential_pickup",
  "residential_delivery",
  "limited_access_pickup",
  "limited_access_delivery",
  "appointment_delivery",
  "notify_before_delivery",
  "protect_from_freeze",
  "other",
];

export function emptyPlace() {
  return {
    city: null,
    state: null,
    postal_code: null,
    country: "US",
  };
}

export function emptySheet({ id, now } = {}) {
  const created = now ? new Date(now).toISOString() : new Date().toISOString();
  return {
    schema_version: SCHEMA_VERSION,
    quote_request_id: id || (globalThis.crypto?.randomUUID?.() ?? `qr_${Date.now()}`),
    created_at: created,
    status: "collecting",
    out_of_scope_reason: null,
    error_reason: null,
    mode: "LTL",
    lanes: {
      origin: emptyPlace(),
      destination: emptyPlace(),
    },
    freight: {
      pieces: null,
      total_weight_lbs: null,
      dims: null,
      freight_class: null,
      commodity: null,
      hazmat: null,
      stackable: null,
    },
    pickup: {
      date: null,
      ready_time_local: null,
      accessorials: [],
      accessorials_other: null,
    },
    contact: {
      name: null,
      email: null,
      phone: null,
      company: null,
    },
    notes: null,
    quote_result: null,
  };
}

export function cloneSheet(sheet) {
  return structuredClone(sheet);
}
