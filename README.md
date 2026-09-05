# Bont

Bont ist eine mobile, offlinefähige Fitness-PWA für drei zusammenhängende Bereiche:

- **Training:** flexible 1er- bis 7er-Splits, eigener Planeditor, laufende Workouts, Satzwerte und Übungsverlauf
- **Körperanalyse:** Gewicht, Kalorien und Schritte mit 7-/14-Tage-Auswertung und geschätztem Erhaltungsbedarf
- **Ernährung:** frei benennbare Mahlzeiten, Tagesziel, Makros und vorbereitete Mikronährstoffansicht

## Technische Grundlage

- React 19, TypeScript und Vite
- Supabase Auth und Postgres mit Row Level Security
- Dexie/IndexedDB für lokale Daten und eine Offline-Synchronisationswarteschlange
- installierbare PWA mit Service Worker
- Vercel-Deployment

Alle persönlichen Tabellen besitzen `id`, `user_id`, `created_at`, `updated_at` und `deleted_at`. Abhängige Tabellen verwenden zusätzlich zusammengesetzte Fremdschlüssel, damit Daten nicht versehentlich nutzerübergreifend verknüpft werden können.

## Lokale Entwicklung

Voraussetzung: Node.js 22 oder neuer.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Erforderliche Variablen:

```dotenv
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
```

Nur der öffentliche Supabase-Publishable-Key gehört in die Browser-App. Ein `service_role`- oder Secret-Key darf niemals in einer `VITE_`-Variable oder im Repository stehen.

## Datenbank

Die SQL-Migrationen liegen unter `supabase/migrations`. Jede Tabelle hat aktive RLS-Regeln, die Zugriffe auf `auth.uid() = user_id` begrenzen.

## Anmeldung

Die erste Version verwendet einen einmaligen E-Mail-Link. In Supabase müssen die lokale URL und die Vercel-URL unter **Authentication → URL Configuration** als erlaubte Redirect-URLs hinterlegt sein.

## Befehle

```bash
npm test
npm run build
npm run preview
```

## Geplante native Integrationen

Die Daten- und Feature-Grenzen sind bereits auf eine spätere Expo/React-Native-App vorbereitet. Apple HealthKit, Android Health Connect, Kamera-Barcodes, Push-Mitteilungen, Widgets, biometrische Anmeldung sowie Apple Watch/Wear OS werden erst in der nativen Phase ergänzt.
