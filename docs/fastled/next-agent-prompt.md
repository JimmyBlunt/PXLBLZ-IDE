# Übergabe-Prompt: FastLED-Integration fertigstellen

Arbeite im Online-Repository
[`JimmyBlunt/PXLBLZ-IDE`](https://github.com/JimmyBlunt/PXLBLZ-IDE) auf dem
Branch
[`feature/fastled-runtime`](https://github.com/JimmyBlunt/PXLBLZ-IDE/tree/feature/fastled-runtime).
Klone diesen Branch in einen eigenen Worktree. Verändere weder `main` noch einen
ArtNet-Entwicklungsbranch. Nutze für parallele Änderungen getrennte Worktrees
oder klar getrennte Dateibereiche.

Lies zuerst die online verfügbaren Grundlagen:

- [Machbarkeitsstudie](https://github.com/JimmyBlunt/PXLBLZ-IDE/blob/feature/fastled-runtime/docs/fastled/feasibility.md)
- [Compiler-Architektur](https://github.com/JimmyBlunt/PXLBLZ-IDE/blob/feature/fastled-runtime/docs/fastled/compiler.md)
- [Abnahmekriterien](https://github.com/JimmyBlunt/PXLBLZ-IDE/blob/feature/fastled-runtime/docs/fastled/acceptance.md)
- [Validierungsplan](https://github.com/JimmyBlunt/PXLBLZ-IDE/blob/feature/fastled-runtime/docs/fastled/validation.md)
- [Produktions-Compile-Beleg](https://github.com/JimmyBlunt/PXLBLZ-IDE/blob/feature/fastled-runtime/docs/fastled/production-compile-proof.json)
- [Testbelege](https://github.com/JimmyBlunt/PXLBLZ-IDE/tree/feature/fastled-runtime/docs/fastled/evidence)
- [FastLED-CLI-Patchanleitung](https://github.com/JimmyBlunt/PXLBLZ-IDE/blob/feature/fastled-runtime/vendor/fastled-cli/README.md)

FastLED ist ausschließlich für Rendering auf dem Computer vorgesehen; keine
Pixelblaze-Hardware-Ausgabe. Behaupte keine vollständige Kompatibilität ohne
nachprüfbare Kriterien.

Koordiniere vier parallele Arbeitspakete. Jeder Agent soll einen kleinen,
reviewbaren Commit mit Tests und einer Ergebnisnotiz liefern. Überschneidende
Dateien müssen vorab einem einzigen Agenten zugeordnet werden.

## Agent A – offizieller FastLED-CLI-Patch

Verwende das offizielle Repository
[`FastLED/cli`](https://github.com/FastLED/cli) am gepinnten Commit
[`bb1d619c1d64194198f9c68ac852fc79e6a01d9e`](https://github.com/FastLED/cli/commit/bb1d619c1d64194198f9c68ac852fc79e6a01d9e).
Wende den online gespeicherten Patch
[`0001-preserve-sketch-configuration.patch`](https://github.com/JimmyBlunt/PXLBLZ-IDE/blob/feature/fastled-runtime/vendor/fastled-cli/patches/0001-preserve-sketch-configuration.patch)
an. Führe zuerst die Rust-Preprocessor-Tests aus, baue danach eine headless
Release-Binärdatei und starte den
[`FastLED-Compiler-Service`](https://github.com/JimmyBlunt/PXLBLZ-IDE/blob/feature/fastled-runtime/scripts/fastled/server.mjs)
mit dieser Binärdatei über `FASTLED_CLI`. Prüfe:

- [`hsv-spectrum.ino`](https://github.com/JimmyBlunt/PXLBLZ-IDE/blob/feature/fastled-runtime/scripts/fastled/fixtures/hsv-spectrum.ino)
  liefert exakt das native FastLED-3.10.4-Ergebnis `[155,95,0]` statt des
  früheren `[171,85,0]`.
- [`fastled-prototype-order.ino`](https://github.com/JimmyBlunt/PXLBLZ-IDE/blob/feature/fastled-runtime/scripts/fastled/fixtures/fastled-prototype-order.ino)
  kompiliert unverändert und liefert `[17,34,51]`.
- Alle sechs Quellen im
  [unveränderten IDE-Beispielquellen](https://github.com/JimmyBlunt/PXLBLZ-IDE/tree/feature/fastled-runtime/src/engine/fastled/examples)
  kompilieren unverändert.
- Der Patch lässt sich auf einem frischen Clone reproduzierbar anwenden.

Dokumentiere CLI-Version, Upstream-Commit, Patch-Hash, Befehle, Laufzeiten und
Artefakt-Hashes. Falls der Patch fachlich falsch ist, repariere Patch und Tests;
umgehe die Abweichung nicht durch Quelltextänderungen an den Beispielen.

## Agent B – Matrix-Abnahme und Performance

Nutze das offizielle
[`FastLED/FastLED`](https://github.com/FastLED/FastLED)-Repository am Tag
[`3.10.4`](https://github.com/FastLED/FastLED/tree/3.10.4) beziehungsweise am
Commit
[`adedfc40e73fb80f8e930318781036d8fe1dbd9f`](https://github.com/FastLED/FastLED/commit/adedfc40e73fb80f8e930318781036d8fe1dbd9f).
Wähle das offizielle
[`examples/Animartrix`](https://github.com/FastLED/FastLED/tree/3.10.4/examples/Animartrix)
als anspruchsvollen Matrix-Haupttest und
[`examples/WasmScreenCoords`](https://github.com/FastLED/FastLED/tree/3.10.4/examples/WasmScreenCoords)
als Geometrie-Kontrolltest. Übernimm Quellen nur gemäß MIT-Lizenz und mit
Provenienzdatei. Erzeuge einen deterministischen nativen Referenzlauf und einen
Lauf über exakt den produktiven WASM-Compiler und den
[`runtime.worker.ts`](https://github.com/JimmyBlunt/PXLBLZ-IDE/blob/feature/fastled-runtime/src/engine/fastled/runtime.worker.ts).
Vergleiche Frame-Geometrie, RGB-Bytes, Zeitsteuerung und Resetverhalten.
Messe kalten Build, warmen Build, WASM-Größe, Initialisierungszeit,
Frame-Durchsatz und Hauptthread-Reaktionsfähigkeit. Speichere maschinenlesbare
Resultate im
[`docs/fastled/evidence`](https://github.com/JimmyBlunt/PXLBLZ-IDE/tree/feature/fastled-runtime/docs/fastled/evidence)-Verzeichnis;
erkläre Abweichungen statt Grenzwerte nachträglich passend zu setzen.

## Agent C – FastLED-Bereich und Beispielkatalog

Implementiere in der PXLBLZ-IDE einen eigenen sichtbaren Bereich/Ordner
`FastLED` mit Unterordnern für die offiziell bereitgestellten Beispiele. Nutze
eine versionierte Manifestdatei mit Titel, relativen Quelldateien,
FastLED-Version, Upstream-Commit, Lizenz/Provenienz, Dimension und optionalem
Vorschau-Artefakt. Starte mit den bereits geprüften Quellen im
[`IDE-Beispielkorpus`](https://github.com/JimmyBlunt/PXLBLZ-IDE/tree/feature/fastled-runtime/src/engine/fastled/examples)
plus den beiden Matrix-Abnahmekandidaten. Die Originalquellen müssen unverändert
bleiben; IDE-spezifische Metadaten liegen separat. Ein Vorschau-Cache ist
zulässig, wenn sein Schlüssel mindestens Quellhash, Compilerfingerprint,
Bridge-ABI und FastLED-Version enthält und die IDE bei fehlendem oder falschem
Hash sicher neu kompiliert. Füge UI-Tests für Navigation, Öffnen, Kopieren in
einen editierbaren Sketch und Cache-Fallback hinzu.

## Agent D – unabhängige Regression und Review

Ändere zunächst keinen Produktcode. Prüfe die Commits der anderen Agenten und
führe TypeScript, ESLint, fokussierte Vitest-Suites, vollständige Tests,
Produktionsbuild, echte Browser-Abnahme und den nativen/WASM-Paritätslauf aus.
Kontrolliere besonders Abbruch, Pause, Reset, Endlosschleifen, mehrere Strips,
maximale Pixelzahl, Compilerdiagnosen, Cache-Integrität und das Verlassen des
isolierten Vorschau-Dokuments. Suche nach ungeprüften Kompatibilitätsaussagen,
Lizenzproblemen und eingebetteten lokalen Pfaden. Liefere Findings mit Datei und
Zeile; fixe bestätigte Probleme in separaten Commits.

## Gemeinsame Abschlusskriterien

Die Arbeit ist erst mergefähig, wenn der gepatchte offizielle CLI-Build
reproduzierbar ist, der HSV-Makrotest und der Prototyptest bestehen, die sechs
Standardbeispiele sowie Animartrix und WasmScreenCoords im Produktpfad laufen,
alle automatisierten Prüfungen grün sind und die Belege die Leistungswerte und
bekannten Grenzen nennen. Aktualisiere den Feature-Branch gegen den aktuellen
[`main`](https://github.com/JimmyBlunt/PXLBLZ-IDE/tree/main), löse Konflikte mit
Tests und führe den vollständigen Prüfplan danach erneut aus. Merge erst
anschließend per Fast-Forward oder geprüftem Merge-Commit in `main`; bestehende
ArtNet-Arbeit niemals verwenden, überschreiben oder bereinigen.
