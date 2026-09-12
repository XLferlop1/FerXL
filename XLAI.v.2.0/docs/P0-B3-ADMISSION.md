# P0-B3 Closed-Alpha Admission

P0-B3 maps the verified Firebase UID to `internal_users.firebase_uid`. The
server creates unknown users as `pending`; only an operator may promote a
pending user to `active`. Browser fields and public HTTP routes cannot change
this state.

For closed-alpha activation, an operator may run a direct database statement
through the protected database administration path:

```sql
UPDATE internal_users
SET status = 'active'
WHERE firebase_uid = '<verified-firebase-uid>'
  AND status = 'pending';
```

This changes only a pending user. It is not a browser control, application
route, role header, or shared secret. The operator should verify the affected
row count before treating the account as admitted.

Authenticated and active does not yet grant safe access to arbitrary resource
IDs. Conversation, journal, coach, and derived-data ownership enforcement is
deferred to P0-B4 through P0-B6.