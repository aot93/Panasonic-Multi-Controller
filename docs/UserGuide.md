# Projector Control — User Guide

A plain-English guide to installing and using the app. No technical
knowledge required.

## 1. Installation

- No installer needed — it's a single program plus two small folders.
- Copy the whole release folder to the computer that will run the app.
  Keep `ProjectorControl.exe` together with the `public` and `migrations`
  folders next to it — the app needs all three in the same place.
- Double-click `ProjectorControl.exe` to run it. Windows may show a blue
  "Windows protected your PC" warning because the program isn't
  digitally signed — click **More info**, then **Run anyway**.
- On first launch, the app creates a `data` folder next to itself. This
  holds every projector, group, macro, and setting you configure.
  **Back this folder up** if you want to keep your setup — deleting it
  resets the app back to empty.

## 2. Launching and accessing the app

- Double-click `ProjectorControl.exe`. A black console window opens and
  stays open — that's the app running. Closing that window shuts the app
  down.
- Open a web browser (Chrome, Edge, Firefox) on the same computer and go
  to:

  ```
  http://localhost:8080
  ```

- To use it from another device on the same network — a phone, tablet,
  or another PC — use this computer's network address instead, e.g.
  `http://192.168.0.140:8080`. The app itself shows the correct address(es)
  to use in the top-right corner of the screen once it's running.
- Leave the console window running in the background for as long as you
  want the app available. There's nothing else to start or configure.

## 3. Overview of functions

The app is organised into seven tabs across the top of the screen.

### Devices

- Add a projector by its network address — one at a time, or a whole
  range of addresses at once (each one gets an automatically numbered
  name, e.g. "Projector 1", "Projector 2", ...).
- Every projector shows as a card: status colour, power state, current
  input, shutter position, aspect ratio, and screen setting. Click a card
  for its temperature and lamp-hour history.
- Rename, delete, or set a custom login for any projector from its card.
  Double-click a card (or its small ↗ icon) to open that projector's own
  built-in web page in a new tab.
- Tick checkboxes to select several projectors at once — hold **Shift**
  and click another checkbox to select every card in between. A toolbar
  appears at the bottom for the selection: send a command, run a macro,
  or add/remove them from a group. Powering off or removing from a group
  asks you to confirm first, so a stray click can't do either by
  accident.
- Groups (e.g. by room or floor) are created in the Settings tab; chips
  above the projector grid let you filter or select an entire group with
  one click.

### Macros

Build your own custom multi-step buttons — a named sequence of commands,
with a short pause between each, that runs against a projector, a group,
or every projector at once. Useful for routines like "Morning start-up"
or "End of day shutdown".

A step can also run another macro instead of a command, so a "Full
Startup" macro can call a "Power On" macro and a "Set Inputs" macro rather
than duplicating their steps. You can't build a loop this way — a macro
that would end up calling itself, directly or through a chain of other
macros, is rejected when you try to save it.

### Triggers

Let another system on your network fire off a command or macro by sending
it a short text key over the network (TCP or UDP) — useful for hooking the
app up to a lighting console, AV switcher, or show-control system.

- Turn the listener on and choose a UDP and/or TCP port in the panel at the
  top of the tab. It's off by default.
- Add a trigger: give it a key (the text the other system will send),
  choose what it should run (a command or a macro) and against which
  projector, group, or all of them.
- Each trigger shows when it last fired, and can be temporarily disabled
  without deleting it.

### Preview

- See a live thumbnail of what each projector is actually displaying, or
  expand one to a larger view. Click **Start** on a projector to connect
  its preview — this doesn't happen automatically, since watching every
  projector at once uses a lot of network bandwidth.
- **Verify Name** reads the projector's on-screen text and checks it
  matches the name you've given it in the app — a quick way to confirm a
  projector is correctly identified before a show. **Verify all** runs
  this check across every visible projector in one go.
- Spot a wrong name while checking? Rename the projector right there in
  its preview tile.

### Logs

A running list of everything the app has flagged — connection problems,
projector self-reported errors, and so on — each with the date and time
it happened.

### Settings

- Set the default login (username/password) the app uses to connect to
  your projectors, with the option to override it for individual units.
- Adjust how strict the "Verify Name" check is, if it's rejecting good
  reads or accepting bad ones too often.
- Create and manage groups.
- Add your own custom control commands, beyond the built-in set.
- Save your whole setup — projectors, groups, commands, macros — to a
  file, or load one back in. Handy for backups or moving to a new
  computer. Login details are never included in this file.

### About

What version you're running, the license this app is provided under, and
a copy of this very guide — all viewable without leaving the app. Also has
a contact link if you need to report a problem or ask a question.

### Always visible

- Top-right: a green or red dot shows whether the app's live connection
  is working, and a **Pause polling** button temporarily stops it
  checking on projectors in the background — sending commands manually
  still works while paused.
- Just below that: the network address(es) other devices on your network
  can use to reach this app.
