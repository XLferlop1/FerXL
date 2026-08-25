# XLAI Safety Corpus Data Provenance

Version: 0.1

This document defines provenance, privacy, access, and contamination rules for future XLAI Safety Corpus data. It does not authorize collection of real user conversations or change current product behavior.

## Provenance Boundary

The Safety Corpus is a governed labeled-example and evaluation source. The Safety Knowledge Base remains the authoritative policy source, and the deterministic Safety Engine remains authoritative for current live enforcement. Synthetic model output is never automatically ground truth. Model-generated examples and labels require review before they can become gold.

Every future record must have traceable metadata for source class, creation method, provenance, review state, and any transformation or de-identification performed.

## Allowed Provenance Classes

These classes match the current corpus schemas:

### `synthetic`

Created artificially by a human, template, program, or model for corpus coverage. Synthetic data must be labeled as synthetic, must not be presented as lived experience, and requires review before gold status.

### `curated`

Authored or selected by project contributors for a defined corpus purpose. The creation method, selection rationale, and reviewer history must be traceable.

### `public_research_derived`

Derived from public research material under an approved use basis. The source citation or provenance record must be retained, and the transformation must not imply that public text is automatically suitable for XLAI policy or safety labels.

### `licensed`

Obtained under a license that permits the intended corpus use. License scope, restrictions, attribution requirements, and approved use must be recorded.

### `deidentified_real_world`

Derived from real-world material after an approved privacy review and de-identification process. This class requires an appropriate consent or legal basis, documented transformation, access controls, retention controls, and governance approval before use.

### `internal_evaluation`

Created or reserved for internal evaluation, QA, calibration, or disagreement analysis. It must remain separated from development data unless an explicit, versioned decision permits a controlled transformation.

## Required Record Metadata

For every future record, require traceable metadata describing:

- source class;
- creation method;
- provenance;
- review state;
- annotation certainty;
- transformation and de-identification details when applicable;
- relevant source or version identifier without exposing unnecessary identity data.

The current schemas require `source`, `creationMethod`, `reviewStatus`, `annotationCertainty`, `annotationNotes`, and `provenance`. `reviewStatus` is review quality (`draft`, `reviewed`, `gold`); `annotationCertainty` is evidence clarity (`clear`, `uncertain`, `ambiguous`) and is not model confidence. These fields are metadata requirements, not permission to collect sensitive data.

## Synthetic Data and Model Output

Synthetic model output is never automatically ground truth. A generated example or label must be reviewed against observable evidence, the existing Knowledge Base, near-miss guidance, and this quality standard before it can be marked `gold`.

Model confidence is not annotation quality. Generated reasoning must remain a concise, non-sensitive summary rather than hidden chain-of-thought. Synthetic data must include uncertainty and negative or near-miss coverage where relevant, and must not introduce replacement categories or policy.

## Real-World Data

Real XLAI user conversations must not automatically enter the corpus. Future real-world data use requires appropriate:

- consent or legal basis;
- privacy review;
- de-identification;
- retention controls;
- access controls;
- governance approval.

This document does not invent a legal consent mechanism that does not currently exist. Until an approved process exists, use synthetic, curated, public-research-derived, licensed, or internal-evaluation data as appropriate.

## Privacy and Minimization

Remove or transform unnecessary personally identifying information from corpus records. Prefer synthetic placeholders for names, locations, organizations, contact details, account details, and other identifiers.

Do not store:

- passwords;
- authentication secrets;
- access tokens;
- financial account credentials;
- unnecessary addresses;
- unnecessary phone numbers;
- unnecessary email addresses;
- other direct identifiers;

unless a future specifically approved evaluation requires a synthetic representation. Even approved evaluation use must document why the information is necessary, who can access it, how long it is retained, and how it will be removed.

Do not use corpus data to infer identity, diagnose people, or expose private conversations. Safety-sensitive content requires the same privacy discipline as other corpus content, with additional care around locations, threats, relationships, and crisis language.

## Separation of Data Uses

Keep these data domains separate:

- **development corpus:** used for annotation design, coverage, prototyping, and development;
- **evaluation corpus:** reserved for unbiased measurement and protected from routine tuning;
- **real-world shadow-mode telemetry:** future internal comparison data, subject to separate approval, privacy controls, and retention rules.

These domains must not silently flow into each other. A transfer requires a documented purpose, versioned decision, provenance update, and review of contamination and privacy implications.

## Contamination Prevention

Evaluation examples must not be copied into training or development data without an explicit versioned decision. Do not use evaluation labels to tune prompts, rules, semantic signals, thresholds, or annotation guidance and then report the same examples as unbiased evaluation.

When a transfer is approved, retain the original source identity, transformation history, and split history. A derived record must not obscure that it originated in an evaluation set.

## Retention and Access

Future governance must define access by role and purpose, retain only what is necessary, and delete or reprocess data according to approved retention controls. Sensitive source material should have narrower access than de-identified synthetic or curated records.

No runtime loader or production integration is created by this foundation. Provenance documentation alone does not authorize data ingestion or telemetry collection.

Behavioral context in corpus records does not authorize persistent production behavioral or psychological profiles. Any future baseline or interaction-history feature requires separate privacy, retention, access, and governance approval. This revision uses only synthetic Pilot A data and does not ingest real conversations.
