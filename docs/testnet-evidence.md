# Testnet evidence (17 and 18 Nov 2026)

Published by AETERNUM AURUM PARTNERS on **XRPL Testnet** while building this kit. Test tokens have no value. Open any hash in a Testnet explorer, for example `https://testnet.xrpl.org/transactions/<hash>`.

| What | Transaction hash | Result |
|---|---|---|
| Class oracle, ENSO phase (document 1; pairs ENSO_FASE = 1, ENSO_INT = 4; URI = sha256 of the record) | `A9B40CEBD4F33E18C8BBDD4A6783D60B10A6534AB51CB433DEB04DDCDFEFDF80` | tesSUCCESS |
| Class oracle, EXAMPLE risk class (document 2; pair RISCO_EX_5218805 = 2; the old unmarked pair removed) | `FE5968411476D6CC9BEC2C56146A2E2073A6186F80BB2593D9866C15E6953EA4` | tesSUCCESS |
| Credential issued to the test carrier (type TRANSPORTADORA, 89 days) | `E0A68A2B986807F99EAD4D341A1DEF4B341AEF464BACA58DC483A3CAE364F969` | tesSUCCESS |
| Credential accepted by the test carrier | `DE610937505566D52F504BE5DBF89D3443DBB19EE94B441F2F17B71059F69FFE` | tesSUCCESS |
| Agent pays the verified carrier inside its mandate (test token, fictitious lot) | `F8D57D9FA45D0F417919A08951CA89EF610D080EA178615BFDBC75E820B1508A` | tesSUCCESS |
| Agent refuses an over-limit request and an unverified counterparty | none (no transaction is built on refusal) | refused |
| Pay-per-query: the agent buys the ENSO indicator (invoice id in the memo); the server answers 200 | `1FE7EE067FB3F822BE9C1FAF2FE9010E769797FD234B42C850095DC58C0B1E82` | tesSUCCESS |
| Conditional escrow A (PREIMAGE-SHA-256): oracle class within the agreed maximum, released by the agent with the fulfillment (18 Nov) | `3CA973CBFB6B33D38BB1160035930B4E406198254CC9512983F28D2979BF43E8` | tesSUCCESS |
| Conditional escrow B: oracle class above the agreed maximum, not released; cancelled after CancelAfter, funds back to the payer (18 Nov) | `C2226442DB4D26E7C3A7938B7F6A98548A07E9F9B7605F4846C181C1DED9B401` | tesSUCCESS |
| Fictitious coffee lot as an MPT receipt with RequireAuth (EXAMPLE metadata, hash of the full lot file) (18 Nov) | `3821E43E479B374561706477936998A872FA4289166783E1E6863554EB629122` | tesSUCCESS |
| Receipt delivered to a verified holder (member of a Permissioned Domain, credential checked on ledger) | `C160BE27E1D6C6A377619FC08AF6D60B00160054C6388C67844C3F234662ADC7` | tesSUCCESS |
| Receipt to an unverified holder: **refused by the ledger** | `6A56D10CB0562B179E0F87576A626E006E0E31952BF06D1BA0F66B6EF4C048D6` | tecNO_AUTH |

Labels in these transactions are in Portuguese (ENSO_FASE, TRANSPORTADORA) because they were produced by the publisher's own tooling before the kit; the kit's examples use English names (ENSO_PHASE, CARRIER).
