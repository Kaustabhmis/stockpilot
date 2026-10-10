# The Dome Box mark

![the mark](../tests/logo-candidates.png)

The silhouette **is** the name: a dome sitting on a box. The tick inside says
what the product does — work goes in, somebody signs it off.

## Why this one

Eighteen candidates were drawn and rendered at 88, 48, 28 and 16px on both a
light and a dark surface, which is where most marks fall apart. The ones that
did not survive, and why:

- a cloche shape read as **food delivery**
- an arch with a handle read as a **padlock** — the wrong promise entirely
- a stack of bars read as **any list app ever made**
- a split dome read as a **hot-air balloon**
- the `D` monogram was legible everywhere but said nothing about the product,
  and the counter made it look like a power button

## The artwork

One path for the body, one for the tick, on a 100×100 viewBox, so it drops into
the header, the favicon and the emails unchanged.

```
M12 52 A38 38 0 0 1 88 52 L88 76 A12 12 0 0 1 76 88 L24 88 A12 12 0 0 1 12 76 Z
M35 55 L46 66 L67 42        (stroke 10, round cap and join)
```

| Where | Body | Tick |
|---|---|---|
| Light surfaces | `#5b4bdb` | `#ffffff` |
| Dark surfaces | `#ffffff` | `#5b4bdb` |

Contrast, measured: white tick on violet **6.04:1**, violet body on the page
background **5.70:1**, white body on the dark plum **18.45:1**. The inverted
variant exists because the violet body on dark plum is only 3.05:1 — legal for
a graphic, but too close to rely on.

It is inline SVG everywhere, never an image file: nothing to fetch, nothing to
404, and it is painted before anything else on the page has loaded. In email it
is drawn as a table cell with a border radius and a `&#10003;`, because no mail
client can be relied on to render an SVG or load a remote image.
