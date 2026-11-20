# Hardwarefreie Tests

Die regulären Python- und JavaScript-Tests arbeiten mit lokalen Daten und Mocks. Sie dürfen keine Verbindung zu privaten Receivern, Heimautomatisierung oder anderen Geräten herstellen. Für die lokale Prüfung eignet sich `python -m unittest discover -s testsuite -p 'test_*.py'` beziehungsweise `node --test testsuite/test_*.js`.

## Automatische CI-Prüfung

Die Workflows `build.yml` (Push auf `main`) und `pull.yml` (Pull Requests gegen `main`) rufen den gemeinsamen Workflow `.github/workflows/tests.yml` auf, auch bei manuellem Start. Er prüft die Python-Tests mit Python 3.13 bis 3.15 und die JavaScript-Tests mit Node.js 22. Die bisherigen Builds starten nur nach erfolgreichen Tests; bei Testfehlern wird auch die Veröffentlichung verhindert. Checkout verwendet im Test-Workflow den Stand des auslösenden Ereignisses, bei Pull Requests den Merge-Stand.

Für lokale Gesamtläufe werden `CT3` (Cheetah), `requests` und Node.js benötigt. Installation der Python-Abhängigkeiten: `python -m pip install CT3 requests`. Node.js muss auch für den Python-Testlauf verfügbar sein, da einzelne Tests JavaScript-Unterprozesse prüfen. Die JavaScript-Tests benötigen keine npm-Installation. Die Muster `test_*.py` und `test_*.js` nehmen neue reguläre Tests automatisch auf; manuelle Receiver-Prüfskripte werden nicht gestartet. In der CI ist `OPENWEBIF_ALLOW_HARDWARE_TESTS=NO` gesetzt.

Die Sommerzeit-Tests verwenden `zoneinfo` mit `Europe/Berlin`. Auf Systemen ohne IANA-Zeitzonendaten (insbesondere Windows) zusätzlich `python -m pip install tzdata` installieren.

## Gerenderte moderne EPG-Integration

Der zusätzliche Pflichtjob `epg-integration` im gemeinsamen Test-Workflow prüft die Zeitschrift und den Zeitstrahl mit Python 3.13, Node.js 22 und Chromium. Cheetah rendert die vollständigen Templates `myepg.tmpl` und `multiepg.tmpl` samt produktiven Render-Helfern; der Browser lädt die in `main.tmpl` eingebundenen externen EPG-Skripte und Styles aus `plugin/public/modern` mit dem mitgelieferten jQuery. Keine JavaScript-Funktionen werden aus Templates extrahiert. Die klassischen EPG-Templates werden weder geladen noch verändert.

Die Tests decken Tages-/Wochenwechsel, Kalenderauswahl, Uhrzeit-/Jetzt-Sprünge, mehrere Aktualisierungszyklen, wiederholtes Nachladen sowie das Aufräumen und Neustarten beim Verlassen beziehungsweise Ansichtswechsel ab. Uhrzeit und Zeitzone sind festgesetzt. Nur der umgebende Anwendungsrahmen und die API-Antworten werden ersetzt: Daten entsprechen dem Controller-Vertrag, sind aber lokale Fixtures, keine echten Enigma2-Abfragen. Jede Browseranfrage wird abgefangen; unbekannte oder externe Ziele und JavaScript-Fehler lassen die Prüfung scheitern.

Einmalig vorbereiten (zusätzlich zu `CT3` und Node.js):

```text
npm ci --prefix testsuite/integration --ignore-scripts --no-audit --no-fund
node testsuite/integration/node_modules/playwright/cli.js install chromium
```

Auf Linux bei Bedarf Browser-Systembibliotheken mit `install --with-deps chromium` installieren. Danach separat ausführen:

```text
python -m unittest discover -s testsuite/integration -p 'test_*.py' -v
```

Die schnellen bestehenden Testläufe bleiben unverändert und benötigen keinen Browser. Fehlende Browserabhängigkeiten werden im separaten Integrationstest als Fehler gemeldet, nicht übersprungen.

## Moderne Aufnahmensuche

`test_movie_search.py` prüft den Suchcontroller sowie die gerenderten Vorlagen `movies.tmpl` und `moviesearch.tmpl`; `test_modern_movie_view.js` prüft Such-URLs und das Erhalten von Ordner, Ansicht und Suchbegriff. Abgedeckt sind Titel und Beschreibungen, Unterordner, Sortierung, Unicode/Sonderzeichen, leere Suche und fehlende Treffer sowie die minimale und normale Darstellung der Aufnahmenliste und Suchergebnisse. Die Umschaltung wartet auf erfolgreiches Speichern und lädt nur eine weiterhin geöffnete Aufnahmenansicht neu.

Mit den oben genannten Browserabhängigkeiten prüft `python -m unittest testsuite.integration.test_modern_movie_search -v` zusätzlich Button/Enter, Aktualisieren, Sortieren, Tagfilter und Zurücksetzen auf Desktop und Mobilgeräten sowie die sofortige Minimal-/Normal-Umschaltung in Ordneransicht, Gesamtliste und Suche. Dabei werden vollständige Cheetah-Vorlagen, gemeinsame Seitenstile, die echte Symbolschrift und die ausgelieferte Datei `plugin/public/modern/js/responsive.min.js` verwendet; sämtliche Browseranfragen bleiben in lokalen Fixtures. Dieser Test ist auch im separaten Integrationstestlauf enthalten.

## Neustart-Anzeige im Browser

Mit denselben Browserabhängigkeiten prüft `node --test testsuite/integration/reboot_card_browser_tests.js` die Neustart-Karte mit produktiven Styles und Anzeige-Funktionen in drei Themes und drei Bildschirmgrößen, einschließlich langer Hinweise. Der Test arbeitet mit einer lokalen Testseite und blockiert sämtliche Netzwerkanfragen; ein Receiver wird nicht neu gestartet.

## Manuelle Hardwareprüfungen

Die älteren HTTP-Integrationstests (`movie_files_testsuite.py`, `status_quo_file_controller.py`) werden standardmäßig übersprungen. Die manuellen Prüfskripte (`receiver_release_check.py`, `probe_modern_browser_receiver.py`, `probe_timer_tags_receiver.js`) sind ebenfalls standardmäßig gesperrt. Es gibt **keine** vorgegebene Geräteadresse mehr.

Nur für bewusst manuell gestartete Prüfungen auf einem **separaten Testgerät** sind `OPENWEBIF_ALLOW_HARDWARE_TESTS=YES` und eine explizite Zieladresse (`ENIGMA2_HTTP_API_HOST` für die HTTP-Tests, `OPENWEBIF_TEST_RECEIVER_HOST` für die manuellen Prüfskripte) erforderlich; der Browser-Tag-Test benötigt zusätzlich `OPENWEBIF_TEST_RECEIVER_USER` und `OPENWEBIF_TEST_RECEIVER_PASSWORD`, die Python-Prüfskripte lesen die Zugangsdaten aus `._work/.creds.json`. Für die Browser-Tag-Prüfung lassen sich `OPENWEBIF_TEST_VIEWPORT_WIDTH`, `OPENWEBIF_TEST_VIEWPORT_HEIGHT` und `OPENWEBIF_TEST_EXPECT_VERSION` optional setzen. Diese Prüfungen gehören nicht zum normalen Testlauf. Insbesondere Upload/Löschen, Installation, Neustart und Standby können den Receiver verändern und sollen niemals gegen persönliche Geräte gestartet werden.