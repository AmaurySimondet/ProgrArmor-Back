# Résolution de progression (timeseries / PRs)

## Ancre de famille (`familyAnchorId`)

Priorité pour filtrer les sets d’une même famille métier :

1. `equivalentTo[0]` si `isExercice`
2. Premier id `isExercice` dans la sélection
3. L’id lui-même

Pas de tuck sur l’ancre.

## Cible de normalisation (`targetVariationId`)

Axe du graphe agrégé :

1. `progressionReferenceVariationId` si défini
2. `DEFAULT_REFERENCE_VARIATION_ID` (tuck `669c3609218324e0b7682b2b`) **uniquement** si `type === STREET_FIGURE_TYPE_ID` (`669cee980c89e9434327caa8`)
3. `equivalentTo[0]`
4. Premier `isExercice` de la sélection
5. Lui-même

## Exceptions `progressionReferenceVariationId`

| Variation cible | Référence |
|-----------------|-----------|
| L-Sit | L-Sit |
| V-Sit | L-Sit |
| Manna | L-Sit |
| Push-ups (et variantes archer / one-arm) | Knee push-ups |
| Pull-ups (et variantes archer / one-arm) | Pull-ups |
| Dips | Dips |

## Type street figure

Seules les variations dont le **type** est `STREET_FIGURE_TYPE_ID` reçoivent le tuck par défaut en l’absence de `progressionReferenceVariationId`.

Les exercices catalogue génériques (`669cee980c89e9434327caa7`, ex. tractions, dips) **ne** basculent plus automatiquement sur le tuck.

## Graphe d’edges

Les ratios inter-variantes passent par `VariationProgressionEdge` et `resolveGraphContextVariationId` (lit `progressionReferenceVariationId` pour L-Sit / V-Sit / Manna, etc.).

Familles avec edges dédiés (scripts `proposeExerciseSpecificProgressionEdges.js`) : L-Sit, push-up, pull-up, dips (archer / one-arm si variations exercice trouvées), human flag (détails).

## Latéral (stats profil)

| `lateralMode` | Filtre |
|---------------|--------|
| `bilateral` | `isUnilateral !== true` |
| `left` | `isUnilateral === true` && `unilateralSide === 'left'` |
| `right` | `isUnilateral === true` && `unilateralSide === 'right'` |

Pas de conversion ×2 entre populations.

## `possibleProgression`

Champ **deprecated** : plus de gate UI. Les cibles PR/timeseries suivent la famille performée et les edges.
