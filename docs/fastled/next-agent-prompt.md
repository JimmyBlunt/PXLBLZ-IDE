# Übergabe-Prompt: FastLED-Integration fertigstellen

Arbeite im Repository `C:\Users\jimmy\src\worktrees\pxlblz-fastled` auf dem
Branch `feature/fastled-runtime`. Verändere weder den vorhandenen ArtNet-Checkout
`C:\Users\jimmy\Documents\~ pROJECTs ~\PXLBLZ_IDE--2--ArtNet\PXLBLZ-IDE`
noch `main`. Nutze getrennte Worktrees oder klar getrennte Dateibereiche. Lies
zuerst `docs/fastled/feasibility.md`, `docs/fastled/compiler.md`,
`docs/fastled/acceptance.md`, `docs/fastled/validation.md`,
`docs/fastled/production-compile-proof.json`, die Belege unter
`docs/fastled/evidence/` sowie `vendor/fastled-cli/README.md`. FastLED ist nur
für Rendering auf dem Computer vorgesehen; keine Pixelblaze-Hardware-Ausgabe.
Behaupte keine vollständige Kompatibilität ohne nachprüfbare Kriterien.

Koordiniere vier parallele Arbeitspakete. Jeder Agent soll einen kleinen,
reviewbaren Commit mit Tests und einer Ergebnisnotiz liefern. Überschneidende
Dateien müssen vorab einem einzigen Agenten zugeordnet werden.

## Agent A – offizieller FastLED-CLI-Patch

Verwende `https://github.com/FastLED/cli` und den Commit aus
`vendor/fastled-cli/UPSTREAM_COMMIT`. Wende
`vendor/fastled-cli/patches/0001-preserve-sketch-configuration.patch` an.
Führe zuerst die Rust-Preprocessor-Tests aus, baue danach eine headless
Release-Binärdatei und starte `scripts/fastled/server.mjs` mit dieser Binärdatei
über `FASTLED_CLI`. Prüfe:

- `scripts/fastled/fixtures/hsv-spectrum.ino` liefert exakt das native
  FastLED-3.10.4-Ergebnis `[155,95,0]` statt des früheren `[171,85,0]`.
- `scripts/fastled/fixtures/fastled-prototype-order.ino` kompiliert unverändert
  und liefert `[17,34,51]`.
- Alle sechs Quellen in `test/fastled/upstream/` kompilieren unverändert.
- Der Patch lässt sich auf einem frischen Clone reproduzierbar anwenden.

Dokumentiere CLI-Version, Upstream-Commit, Patch-Hash, Befehle, Laufzeiten und
Artefakt-Hashes. Falls der Patch fachlich falsch ist, repariere Patch und Tests;
umgehe die Abweichung nicht durch Quelltextänderungen an den Beispielen.

## Agent B – Matrix-Abnahme und Performance

Nutze den sauberen FastLED-3.10.4-Checkout
`C:\Users\jimmy\src\fastled-upstream-3.10.4`. Wähle `examples/Animartrix` als
anspruchsvollen Matrix-Haupttest und `examples/WasmScreenCoords` als
Geometrie-Kontrolltest. Übernimm Quellen nur gemäß MIT-Lizenz und mit
Provenienzdatei. Erzeuge einen deterministischen nativen Referenzlauf und einen
Lauf über exakt den produktiven WASM-Compiler und `src/engine/fastled/runtime.worker.ts`.
Vergleiche Frame-Geometrie, RGB-Bytes, Zeitsteuerung und Resetverhalten.
Messe kalten Build, warmen Build, WASM-Größe, Initialisierungszeit,
Frame-Durchsatz und Hauptthread-Reaktionsfähigkeit. Speichere maschinenlesbare
Resultate unter `docs/fastled/evidence/`; erkläre Abweichungen statt Grenzwerte
nachträglich passend zu setzen.

## Agent C – FastLED-Bereich und Beispielkatalog

Implementiere in der PXLBLZ-IDE einen eigenen sichtbaren Bereich/Ordner
`FastLED` mit Unterordnern für die offiziell bereitgestellten Beispiele. Nutze
eine versionierte Manifestdatei mit Titel, relativen Quelldateien,
FastLED-Version, Upstream-Commit, Lizenz/Provenienz, Dimension und optionalem
Vorschau-Artefakt. Starte mit den bereits geprüften sechs Beispielen plus den
beiden Matrix-Abnahmekandidaten. Die Originalquellen müssen unverändert bleiben;
IDE-spezifische Metadaten liegen separat. Ein Vorschau-Cache ist zulässig, wenn
sein Schlüssel mindestens Quellhash, Compilerfingerprint, Bridge-ABI und
FastLED-Version enthält und die IDE bei fehlendem oder falschem Hash sicher neu
kompiliert. Füge UI-Tests für Navigation, Öffnen, Kopieren in einen editierbaren
Sketch und Cache-Fallback hinzu.

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
bekannten Grenzen nennen. Rebase den Feature-Branch auf den aktuellen lokalen
`main`, löse Konflikte mit Tests und führe den vollständigen Prüfplan danach
erneut aus. Merge erst anschließend per Fast-Forward oder geprüftem Merge-Commit
in `main`; den ArtNet-Checkout niemals verwenden oder bereinigen.
