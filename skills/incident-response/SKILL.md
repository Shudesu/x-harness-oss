---
name: incident-response
description: Contain and document CUBΣLIC content incidents such as rights, privacy, metadata, duplicate, or unauthorized-publish failures. Use during an incident; require human action for stop, delete, correction, and apology.
---

# Incident Response

1. Identify the incident type, affected post/draft/event, discovery time and evidence without copying credentials or personal data.
2. Call `cubelic_system_status`. If writes are not stopped, instruct an authorized human to use the approval UI emergency-stop control immediately.
3. Preserve logs and create a concise incident record for the operator. Do not delete audit data.
4. Ask a human to decide whether an X post must be deleted and whether members, management, venue, or affected people must be contacted.
5. Draft a correction only when requested. Include the error, correct information, correction time, scope and appropriate apology.
6. Record the root cause and request a regression test before resuming.

Never delete or publish automatically. Never send an automatic correction, apology, reply, or DM.
