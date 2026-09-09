# Bont Food Catalog

## Ziel

Bont verwendet einen internen, versionierten Lebensmittelkatalog in Supabase. Die
Anwendung sucht nur noch gegen diesen Katalog. Externe Quellen werden in einer
reproduzierbaren Import-Pipeline verarbeitet und nicht während jeder Suche
parallel abgefragt.

## Verbindliche Zusammenführungsregeln

- Generische Lebensmittel in Deutschland verwenden BLS als primäre Referenz.
- USDA ergänzt nur fehlende Werte, wenn Lebensmittelzustand und Definition
  ausreichend übereinstimmen.
- Werte verschiedener Quellen werden niemals gemittelt.
- Jeder ausgewählte Nährstoff behält Quelle, Quell-Datensatz, Status und
  Ableitungsart.
- Deklarierte Markenwerte haben Vorrang vor Referenzwerten.
- Referenzwerte werden für Markenprodukte nur pro Nährstoff und nur bei einer
  explizit erlaubten, ausreichend sicheren Zuordnung übernommen.
- `NULL` bedeutet unbekannt. Ein echter Wert `0` bleibt ein echter Wert `0`.
- Rohdaten werden unverändert behalten; Normalisierung und Auswahl sind
  nachvollziehbare Folgeartefakte.

## Quellenstrategie

| Quelle                   | Verwendung                                       | Produktionsstrategie                            |
| ------------------------ | ------------------------------------------------ | ----------------------------------------------- |
| BLS 4.0                  | Deutsche generische Lebensmittel, 138 Nährstoffe | Vollständiger, versionierter Import             |
| USDA Foundation/SR/FNDDS | Referenz- und Lückenwerte                        | Kuratierter Import, kein Suchzeit-API-Fallback  |
| Open Food Facts          | Marken- und Barcode-Produkte                     | Deutschland-/Marktfilter, inkrementelle Upserts |

BLS 4.0 wird als CC BY 4.0 geführt; USDA FoodData Central steht unter CC0.
Open Food Facts erfordert die Beachtung von ODbL/DbCL und der separaten
Bildlizenz CC BY-SA. Die Importläufe speichern Version, Lizenzhinweis und
Quell-URL in `food_import_runs` bzw. `food_sources`.

## Datenfluss

```text
Download/API -> raw source record -> validate -> normalize -> map nutrients
  -> map food identity/state -> deduplicate -> quality flags
  -> select canonical nutrient per food/nutrient -> search index -> API
```

Die Auswahl ist kein Merge zu einem Durchschnittslebensmittel. Eine kanonische
Zeile in `food_nutrients` ist immer eine konkrete Auswahl aus einer
Beobachtung oder eine explizit erlaubte Referenzübernahme.

## Rollout

1. Pipeline mit kleinen lokalen Fixtures aus BLS, USDA und OFF ausführen.
2. Automatische Plausibilitäts- und Mapping-Checks prüfen.
3. Suchranking, Antwortgröße und Datenbank-Latenz messen.
4. Staging-Supabase mit einem kleinen Import befüllen und Smoke-Tests ausführen.
5. Erst danach Schema und Daten in Produktion übernehmen.

Ein Produktionsimport wird absichtlich nicht automatisch aus dem Frontend oder
aus einer Vercel-Request-Funktion ausgelöst.
