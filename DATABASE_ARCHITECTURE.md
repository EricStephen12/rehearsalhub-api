# RehearsalHub Database Architecture & Developer Guide

This document describes the PostgreSQL/Supabase database schema, table naming conventions, and relationships for developers working on the RehearsalHub backend and client applications.

---

## 1. Songs & Repertoire

| Table Name | Primary Purpose | Scope & Description |
| :--- | :--- | :--- |
| **`praise_night_songs`** | **Rehearsal & Event Songs** | The main songs library (~2,400+ songs) prepared and rehearsed for all Praise Nights and services. |
| **`master_songs`** | **All Ministered Songs** | The global ministry catalog (~800+ songs) of ministered songs by Loveworld Singers. Used on the "All Ministered Songs" screens. |
| **`zone_songs`** | **Zone Repertoire** | Songs added specifically for local non-HQ zones. |
| **`subgroup_songs`** | **Subgroup Repertoire** | Songs assigned to specialized sub-groups (e.g. Soprano, Alto, Band). |
| **`praise_nights`** | **Praise Night Events** | Event headers and metadata for Praise Night services (Praise Night 27, 28, etc.). |

---

## 2. User Profiles & Authentication

| Table Name | Description |
| :--- | :--- |
| **`profiles`** | Master user identity directory (740+ singers and administrators). Contains role, name, email, kingschat_id, and access permissions. |
| **`auth_credentials`** | Bcrypt password hashes for email/password authentication. |
| **`refresh_tokens`** | Active JWT refresh tokens linked to profiles (`user_id`). |

---

## 3. Organizational Zones & Memberships

| Table Name | Description |
| :--- | :--- |
| **`zones`** | 20 ministry zones (including HQ and regional groups). |
| **`zone_members`** | User memberships within local zones. |
| **`hq_members`** | User memberships within HQ groups. |
| **`subgroups`** | Choir sub-sections (e.g. Soprano, Alto, Tenor, Band). |

---

## 4. Real-Time Chat & Communications

| Table Name | Description |
| :--- | :--- |
| **`chats`** | Direct 1-on-1 and group conversation channels (`type`, `participants`, `unread_count`). *(Note: `chats_v2` is a backward-compatible view)* |
| **`messages`** | Individual chat messages, attachments, and reactions. *(Note: `messages_v2` is a backward-compatible view)* |
| **`calls`** | Voice and video calling records. *(Note: `calls_v2` is a backward-compatible view)* |
| **`user_statuses`** | User stories and status updates. |

---

## 5. Schedules, Attendance & Audit Logs

| Table Name | Description |
| :--- | :--- |
| **`schedule_programs`** | Rehearsal routines, daily schedules, and program song assignments. |
| **`attendance`** | Rehearsal check-in logs tracked via QR codes. |
| **`activity_logs`** | System audit logs tracking CRUD actions across the app. |
| **`song_history`** | Edit history for song lyrics, keys, tempo, and arrangements. |

---

## 6. Staging & Archival

| Table Name | Description |
| :--- | :--- |
| **`firestore_export`** | Full raw backup & staging table containing all 525,000+ documents from Firebase. |
| **`legacy_*`** | Archived old unused tables from previous prototype iterations. |
