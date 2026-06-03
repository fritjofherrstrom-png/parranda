# Future Product Ideas

**Status:** Future product notes  
**Purpose:** Capture high-potential ideas that are not current implementation priorities, so they are not lost while Parranda focuses on the agnostic engine.

These notes are intentionally not roadmap commitments. They should only become implementation work after the core engine can support them without becoming a gimmick.

## Parranda Social / Social Pulse

Parranda's core product is about understanding the city and composing better day/night moves. A future social layer could extend that from:

```txt
What is the smart move now?
```

into:

```txt
Who else is open to the same kind of move nearby?
```

This should not be a generic social network, dating app, or live tracking map. It should be an opt-in social layer attached to intent, place, route, and moment.

### Core idea

Users or groups can turn on a temporary social presence when they are open to meeting other people around the same place, route, or next move.

Possible modes:

- **Parranda Social** — general opt-in social presence for travelers, locals, groups, and solo users.
- **Parranda Party** — nightlife-oriented mode for bars, music, late-night moves, and groups wanting to continue the night.
- **Social Pulse** — aggregate signal that an area/place has people open to company.
- **Join the Drift** — people heading toward the same next move or route direction.

Example states:

```txt
We are 3 people at this bar.
Open to meet another group.
Vibe: casual drinks / music / food / walk.
Expires in 45 minutes.
```

```txt
Two groups nearby are open to meet for drinks.
One solo traveler is looking for dinner company.
A small group is heading toward live music next.
```

### Design principle

```txt
Social should attach to intent, place, and moment — not raw identity or tracking.
```

The product should expose social opportunity, not exact surveillance.

Prefer:

- group cards over individual GPS dots
- venue/area/route-bound presence over raw live location
- short-lived availability over permanent profiles
- mutual opt-in before chat
- broad intent/vibe matching over dating-style personal ranking
- aggregate signals when counts are low

Avoid:

- exact live user maps
- persistent location trails
- showing a person or group when too few users make them identifiable
- automatic social visibility from normal location permission
- turning Parranda into Tinder, Snapchat Map, or a generic chat app

### Privacy and safety shape

Parranda Social should require explicit opt-in separate from normal location use.

A user can allow precise location for their own route without contributing to Social Pulse or being visible to other users.

Recommended shape:

```txt
Use my location for my own route: on/off
Contribute anonymous city pulse: on/off
Be visible for Parranda Social: on/off, temporary
```

Presence should be:

- opt-in
- temporary
- coarse before mutual contact
- revocable
- minimally retained
- thresholded in small places
- never sold or shared as raw location data

### Product fit

This idea becomes powerful only after Parranda has a strong now/next engine.

Without the engine, social is a gimmick. With the engine, it becomes:

```txt
Parranda finds the next move — and, when you want, helps you find people for it.
```

It could make Parranda useful for:

- solo travelers
- groups looking to join other groups
- locals who want spontaneous plans
- post-dinner “what now?” situations
- nightlife and live-event drift
- city discovery with social momentum

### Potential UI moments

```txt
Social nearby
Two groups are open to meet here tonight.

[Say hi]
[Suggest next place]
[Stay private]
```

```txt
What now?
Parranda found 3 good next moves.

One has Social Pulse:
A small group is also heading there for drinks.
```

```txt
Post-dinner drift
A few people nearby are heading toward music later.
Join a social route or keep it private.
```

### Priority

Not a current implementation priority.

Suggested dependency order:

1. Candidate Intelligence / agnostic engine
2. Blitz now/next
3. City Pulse / aggregate activity signals
4. Parranda Social opt-in layer

The idea should be revisited once Parranda can reliably answer the core question:

```txt
We are here now. What is the smart move?
```

Only then should Parranda ask:

```txt
Do you want to meet others who are open to that move too?
```
