# iPhone Shortcut capture contract

Money Stalker uses two personal automations on each iPhone. The server contract is implemented; the exact fields exposed by the owner's iPhone and Wallet cards still need the device experiment in `IOS_CAPTURE_SPIKE.md`.

Screenshots are not sent by the production automations. The supplied screenshots only established the Bancolombia message formats used by the SMS parser.

## Shared request

Both shortcuts call `POST /capture-events` with:

- `Authorization: Bearer DEVICE_TOKEN`
- `Content-Type: application/json`
- a stable `eventId` generated once and reused if the shortcut retries
- `observedAt`, the time the shortcut received or observed the source event
- `source`, either `sms` or `wallet`

The endpoint returns HTTP 202 only after the event and processing marker are durably saved. A retry with the same event ID and same payload is safe. Reusing the ID with different financial data is rejected.

## SMS automation

The Messages automation filters for Bancolombia transaction messages and sends the message body directly:

```json
{
  "eventId": "SHORTCUT-GENERATED-UUID",
  "source": "sms",
  "observedAt": "2026-10-18T18:43:12-05:00",
  "message": "Bancolombia: ...",
  "location": {
    "latitude": 5.00001,
    "longitude": -73.00001,
    "accuracy": 25,
    "observedAt": "2026-10-18T18:43:15-05:00"
  }
}
```

The parser extracts supported purchase, QR payment, account payment and transfer fields from `message`. It maps masked account/card suffixes through aliases configured in Money Stalker. The raw message remains short-lived evidence and is not copied into the canonical transaction.

## Wallet transaction automation

The Wallet automation sends structured values supplied by the transaction trigger. The target contract is:

```json
{
  "eventId": "SHORTCUT-GENERATED-UUID",
  "source": "wallet",
  "observedAt": "2026-10-18T12:39:05-05:00",
  "date": "2026-10-18",
  "amountMinor": "2598000",
  "currency": "COP",
  "merchant": "TIENDA EJEMPLO",
  "instrumentHint": "wallet-visa-demo",
  "kind": "expense",
  "location": {
    "latitude": 5.00001,
    "longitude": -73.00001,
    "accuracy": 12,
    "observedAt": "2026-10-18T12:39:08-05:00"
  }
}
```

`amountMinor` is an integer string in centavos. The alias in `instrumentHint` points to the corresponding debit or credit account configured under **Cuentas y ajustes → Tarjetas y alias de captura**. If Wallet omits amount, merchant or another field on the real device, the shortcut still sends the event and Money Stalker places it in Review.

## Location behavior

Each shortcut should request one current-location sample after receiving the financial event. Use a short practical timeout. If permission is denied, the location is slow or the device is offline, send or retain the financial event without location rather than dropping it.

The server preserves the coordinates, accuracy and location timestamp on the source observation. Linked location evidence remains visible when opening the movement and is included in CSV/XLSX exports. It is a memory clue, not proof of merchant identity. SMS delivery can be delayed and online purchases can occur away from the merchant.

## Device validation still required

Test SMS and Wallet separately while the phone is locked and unlocked, with location allowed and denied, offline and online, and with physical, online and Watch payments when relevant. Personal automations must be configured on each phone and may expose different Wallet fields by card or payment route.

