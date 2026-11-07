---
name: Motion Lab privacy boundary
description: SPPY's user requirements for camera and voice handling in Motion Lab.
---

Keep Motion Lab camera access opt-in and process camera frames locally in the browser. Never upload, record, persist, or send frames to SPPY's AI service. Voice playback must also be user-initiated. Browser speech recognition may use a browser-managed speech service, so disclose that possibility; only send the resulting text to the AI provider after the user submits it.

**Why:** The user explicitly requires privacy-first hand tracking and no automatic camera or speech playback.

**How to apply:** Preserve these boundaries when extending Motion Lab or adding camera, speech-recognition, or speech-synthesis features.
