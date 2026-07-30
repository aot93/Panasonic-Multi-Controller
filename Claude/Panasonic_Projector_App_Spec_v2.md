# **Technical Specification: Panasonic Projector Multi-Control & Monitoring Application**

*Revision 2 — tech stack updated to align with offline/one-click-install requirements (see Section 3 and Section 7 notes).*

# **1\. Project Overview & Objectives**

The objective of this project is to develop a centralized, robust web-based application designed to monitor and control a fleet of Panasonic projectors across a network. The application aims to provide AV technicians with a unified interface for real-time status tracking, bulk command execution, and automated maintenance scheduling, replacing fragmented manual processes. Key success metrics include high protocol reliability, low latency in device polling, and clear actionable alerting.

The application runs as a single local server — installed on one machine on-site (e.g. a spare PC, NUC, or Mac mini) — which other devices on the same network, including phones and tablets, connect to via a web browser. This satisfies the cross-platform and mobile-access goals without requiring separate native installs per device.

# **2\. Key Features**

* **Monitoring Status:** Real-time dashboard displaying power state, input source, lamp/laser hours, and temperature for all registered devices.  
* **Multi-Device Control:** Ability to group projectors (e.g., by building or room) and issue broadcast commands such as Power On/Off, Shutter Open/Close, and Input Selection.  
* **Automated Scheduling:** Calendar-based task runner to automate daily operations (e.g., shut down all units at 10 PM) to preserve lamp life.  
* **Error Alerting:** Push notifications and logging for critical failures, such as fan errors, over-temperature conditions, or communication loss.

# **3\. Technical Stack**

* **Backend:** Node.js (TypeScript) with Express. Node.js is preferred for its non-blocking I/O, which is ideal for concurrent socket communication with multiple network devices.
* **Frontend:** React with Tailwind CSS and TanStack Query for efficient state management and real-time UI updates. Served as static files directly from the Node server — no separate frontend deployment or hosting step.
* **Database:** SQLite (via `better-sqlite3` or Prisma with the SQLite provider) for structured device metadata and time-series logging of lamp hours/errors. Chosen over PostgreSQL because it requires no separate service to install or configure — it ships as a single file alongside the application, which is a hard requirement given Section 7's offline and one-click-install constraints.
* **Scheduling:** `node-cron` (in-process) for the calendar-based task runner, instead of a Redis-backed job queue. This removes the need to install and run a separate Redis service on-site — Redis is only worth its operational overhead when scaling across multiple server processes, which this application does not need.
* **Real-time Updates:** WebSocket via Socket.io, broadcasting live device status from the Node server to all connected browsers (desktop and mobile) on the local network.
* **Packaging:** Backend and built frontend bundled into a single executable per OS (via Node Single Executable Applications or `pkg`), so installation is "download and run" rather than requiring npm install, database setup, or manual configuration.

*Note on original suggestion:* the original draft of this stack proposed PostgreSQL and Redis. Both are excellent choices for a scaled, server-hosted deployment, but conflict directly with the "one-click installation" and "works offline" requirements in Section 7 — asking an AV technician to install and maintain a database server and a Redis instance on-site isn't compatible with those goals. SQLite and in-process scheduling deliver the same functional capability here without that operational burden.

# **4\. Protocol Implementation (Panasonic Proprietary Computer Control)**

The application will transition from PJLink to the Panasonic proprietary "Computer Control" protocol to access granular hardware data not available in standard protocols. This implementation utilizes TCP port 1024 for socket communication. Core requirements for the integration include:

* Utilization of **TCP Port 1024** as the primary communication gateway for the Computer Control protocol.  
* Implementation of **MD5 Authentication** during the initial connection handshake to secure command transmission.  
* **Socket Communication Patterns:** Handling the 8-byte random challenge issued by the projector to generate the MD5 hash with the administrator password.  
* Precise parsing of query strings for status retrieval, such as lamp hours and internal temperature sensors.

*Implementation Reference (Python):*

```py
import socket
import hashlib

def query_panasonic_projector(ip, password):
    port = 1024  # Panasonic Proprietary Port
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.connect((ip, port))
        # Receive 8-byte random challenge for MD5 auth
        challenge = s.recv(8)
        hash_input = challenge.hex() + password
        auth_hash = hashlib.md5(hash_input.encode()).hexdigest()
        s.sendall(auth_hash.encode())
        
        # Example: Query Lamp Hours
        s.sendall(b"\x02QPW\x03")  # Control byte structure
        response = s.recv(1024)
        return response
```

*Note: this reference implementation is illustrative. The Node.js implementation should be built and tested as an isolated module against a simulated projector before integration, since the exact byte structure of commands beyond this example will need verification against Panasonic's official protocol documentation or real hardware.*

* The full panasonic protocol is in the document "rq35_rz34_command_list_1606346081.8208.pdf" read and understand this.
* The application should allow the user to add comands as required to extend beyond set 
* basic instructions should include:

    * Power on / OFF
    * Shutter open / close
    * input selection
    * Test pattern on / off and type selection
    * Setting of aspect ratio (HV FIT, V FIT etc..)
    * Setting of SCREEN SETTING (16:,16:10 etc..)

* Initial status monitoring should include:

    * Power
    * Temperature
    * Lamp hours
    * Aspect ratio
    * Screen setting

    
# **5\. User Interface Requirements**

* **Grid View:** Thumbnail-style cards for every projector with color-coded status indicators (Green: OK, Yellow: Warning, Red: Error).  
* **Batch Action Bar:** Fixed footer appearing upon multi-selection of cards to trigger group commands.  
* **Custom Buttons:** Ability to program a sequence of actions and bind them to a custom button.  
* **Analytics Pane:** Graphical representation of temperature and other data over time.

# **6\. External Command Triggers**

* **Triggering of commands via TCP/UDP messages:** A protocol for external applications to trigger command actions in the main app.

# **7\. Platform Requirements**

* **Cross-platform compatibility:** The server component must run on Windows and Mac. Mobile access is provided via browser (any device on the LAN can reach the dashboard) rather than a native mobile app.
* **Works offline:** The application must function without an internet connection. This is a primary driver behind the Section 3 stack choice — no external services, cloud databases, or hosted queues are used; everything runs locally on the host machine.
* **Simple installation:** Single downloadable executable per OS, packaged with the frontend and an embedded SQLite database file. No separate database server, Redis instance, or manual configuration step required to get running.
