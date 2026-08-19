# Penpot Slots Plugin

Voegt een slot-systeem toe aan Penpot, vergelijkbaar met Figma Slots (open beta).

## Wat het doet

- Markeer frames als `[slot]` via de plugin
- Bekijk en beheer slot-inhoud per component
- Zoek en browse alle componenten uit de local library
- Leegmaken van slots

## Starten

Lokaal:

```bash
python3 serve.py  # draait op http://localhost:7779
```

Voeg toe in Penpot via: `http://localhost:7779/manifest.json`

## Hosting

`manifest.json` gebruikt `"version": 2`, dus Penpot zoekt `plugin.js` en
`icon.svg` op vanaf de plek waar de manifest staat. Zet deze vier bestanden op een
webserver, in de root of in een submap:

```
manifest.json
plugin.js
index.html
icon.svg
```

En installeer:

```
https://jouw-host/pad/manifest.json
```

Er staat niets omgevingsspecifieks in de bestanden, dezelfde set werkt lokaal en
gehost. De server moet wel `Access-Control-Allow-Origin: *` meesturen (of de
Penpot-origin), dat is wat `serve.py` lokaal doet.

## Workflow

1. Maak een component met geneste frames
2. Selecteer een frame, dan "Markeer als [slot]"
3. Kies een component en voeg hem toe aan het slot
4. Vervangen gaat via hetzelfde paneel, de plugin wisselt de instantie in het slot om

Instanties zijn read-only: selecteer de main component om slot-inhoud te wijzigen.

## Hoe inserten werkt

De plugin probeert altijd de beste route en valt automatisch terug:

1. **Swap**: staat er al een component copy in het slot, dan gaat
   `child.swapComponent(component)`. De instantie blijft in het slot staan en
   Penpot behoudt de overrides die het kan behouden.
2. **Append**: is het slot leeg of staat er gewone content in, dan wordt de oude
   inhoud verwijderd en gaat een nieuwe instantie via `slot.appendChild()` direct
   het slot in.
3. **Canvas**: weigert Penpot dat nog met `:nested-copy-not-allowed`
   (het gedrag van 2.14.x), dan komt de instantie op de slot-positie op het
   canvas te staan en meldt de toast dat je hem er zelf in moet slepen. De
   Penpot-fout wordt naar de console gelogd.

Route 1 en 2 zijn nieuw. `shape.swapComponent()` bestaat sinds
`@penpot/plugin-types@1.4.2`, waarmee de oude blocker vervalt. Welke route je
krijgt hangt af van je Penpot-versie, de toast zegt het.

Het debug-paneel toont onder `capabilities` welke API-methodes jouw Penpot
daadwerkelijk aanbiedt.

## Testen

```bash
npm test
```

Draait `plugin.js` tegen een nagebouwde Penpot API: swap-route, append-route,
de geweigerde nested copy, plaatsen zonder slot, instance-detectie en het
undo-block. Penpot zelf is niet automatiseerbaar, dus dit is de vangnet-laag
voor wijzigingen aan de insert-logica.

## Slot-conventie

Frames met de prefix `[slot]` in de naam worden als slot herkend.
Voorbeeld: `[slot] Leading`, `[slot] Center`, `[slot] Trailing`
