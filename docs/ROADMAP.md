# Compatibility roadmap

Correctness gates expansion. Keep the first two milestones as regression tests for every language change.

1. **Stabilize the procedural subset.** Expand differential fixtures against documented ABAP behavior; improve parser recovery, warnings, contextual completion, inferred type diagnostics, and formatting.
2. **Strengthen internal tables.** Add sorted and hashed storage policies, declared keys and uniqueness, secondary keys, more table operations, field symbols, and mutation-during-iteration semantics.
3. **Exact scalar semantics.** Replace JavaScript-number-backed decimal approximations with decimal arithmetic, add exact 64-bit integers, conversion edge cases, date/time operations, and locale-independent formatting.
4. **Modern expressions.** Add `COND`, `SWITCH`, `CORRESPONDING`, `REDUCE`, `FILTER`, `FOR`, and `LET` as AST nodes with type inference and tests.
5. **ABAP Objects.** Introduce definitions, implementations, visibility, references, constructors, method parameters, call frames, and instance/static dispatch. Then differentiate Step Into and Step Over.
6. **Report ergonomics.** Add richer parameter validation, selection options, multi-file navigation, search across reports, workspace switching, and a more capable language service.
7. **Sandbox Open SQL.** Design a SQL AST and ABAP semantics layer; use local SQLite only after the pure runtime is dependable. No connection to an SAP backend is planned for this release.
8. **Distribution hardening.** Sign Windows builds with an owner-provided certificate, automate release checks, add upgrade/migration testing and accessibility review, and consider other desktop operating systems.

SAP GUI, Dynpro, the SAP kernel, NetWeaver, RFC/BAPI, SAP authorization, transports, real DDIC, LUW, enqueue/update tasks, and full SE80/ADT remain outside scope. This is an independent local programming tool, not an SAP-certified runtime.
