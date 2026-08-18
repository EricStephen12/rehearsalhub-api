# RehearsalHub Database Architecture & Developer Guide

This document describes the standardized PostgreSQL/Supabase database schema, table naming conventions, and relationships for developers working on the RehearsalHub backend and client applications.

---

## 1. Songs & Repertoire

| Table Name | Purpose & Description |
| :--- | :--- |
| **`songs`** | **Main Song Repertoire** (~2,400+ songs). Contains all songs prepared, arranged, and rehearsed for programs, Praise Nights, and services. |
| **`ministered_songs`** | **All Ministered Songs Catalog** (~800+ songs). The global official repertoire of all ministered songs by Loveworld Singers. |
| **`zone_songs`** | **Zone-Specific Repertoire**. Songs added specifically for local non-HQ zones. |
| **`subgroup_songs`** | **Subgroup Repertoire**. Songs assigned to specialized sub-groups (e.g. Soprano, Alto, Band). |
| **`programs`** | **Programs & Rehearsal Events**. Event headers and metadata for all rehearsal programs (Praise Nights, Midweek, Sunday Special, etc.). |
| **`zone_programs`** | **Zone Programs**. Rehearsal programs organized specifically by regional zones. |
| **`subgroup_programs`** | **Subgroup Programs**. Rehearsal programs organized by choir sub-groups (Soprano, Alto, Band, etc.). |
| **`ministered_programs`** | **Ministered Programs**. Program templates for ministered songs services. |

---

## 2. User Profiles & Authentication

| Table Name | Description |
| :--- | :--- |
| **`profiles`** | Master user identity directory (740+ singers and administrators). Contains role, name, email, kingschat_id, and access permissions. |
| **`auth_credentials`** | Bcrypt password hashes for email/password authentication. |
| **`refresh_tokens`** | Active JWT refresh tokens linked to profiles (`user_id`). |
| **`individual_subscriptions`** | User subscription status, tier, and payment references. |

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
| **`chats`** | Direct 1-on-1 and group conversation channels (`type`, `participants`, `unread_count`). |
| **`messages`** | Individual chat messages, attachments, and reactions. |
| **`calls`** | Voice and video calling records. |
| **`user_statuses`** | User stories and status updates. |

---

## 5. Media Assets

| Table Name | Description |
| :--- | :--- |
| **`media_assets`** | Master cloud media storage records for all audio/video/image assets. |
| **`zone_media_assets`** | Zone-specific media files. |
| **`media_videos`** | Video stream records (YouTube / hosted). |
| **`media_playlists`** | Video/media playlists (e.g. Liked Videos). |

---

## 6. Schedules, Attendance & Audit Logs

| Table Name | Aliases & Views | Description |
| :--- | :--- | :--- |
| **`schedule_programs`** | `schedule` | Rehearsal routines, daily schedules, and program song assignments. |
| **`attendance`** | — | Rehearsal check-in logs tracked via QR codes. |
| **`activity_logs`** | — | System audit logs tracking CRUD actions across the app. |
| **`song_history`** | — | Edit history for song lyrics, keys, tempo, and arrangements. |
| **`system_metadata`** | `sys_metadata` | System synchronization and platform metadata. |

---

## 7. Staging & Archival

| Table Name | Description |
| :--- | :--- |
| **`firestore_export`** | Full raw backup & staging table containing all 525,000+ documents from Firebase. |
| **`legacy_*`** | Archived old unused tables from previous prototype iterations. |
