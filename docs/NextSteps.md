Next Steps for multi projector control.

Phases 1 through 4 are now all completed (see docs/PROGRESS.md for the
full history). No further phases queued here yet.



* PHASE 1

1. Add in error logging for each device, a txt  or csv type log file should be created with date time and error code from projector, include as much info as possible. Time and date should be the local PC time not the projector as this is often not in the right time zone. Format the file for easy importing into a spreadsheet for later de-bugging
2. Add an error loging viewer into the main ui
3. Give users the abilitly to save and load project files
4. add eror status, current input, shutter status, Aspect ratio status and screen  to the devices tile
5. remove exhaust and intake and lamp hours from the tile
5. hide devices not in selection group when group is selected
6. add input voltage to the graphs
7. add ui elements and backend so users can add their own control codes to the exisitng set
8. change default user to dispadmin and password to @Panasonic
9. add picture mode to the built in comand set
10. add a ui display for the results of any query type commands




* PHASE 2

The panasonic HTTP web interface includes a remote view function to preview the image being sent to the projector.
The goal is to be able to view the source to each projector in the appplication. bothe as a thumbnail multiview or a larger size single view.
This should be on a seperate page in the app.

 There is no offical documentation for this but can be found at this url http://192.168.0.101/cgi-bin/main.cgi?page=MENU_PREVIEW&lang=e example for projector 101.

I belive this is the source HTML for that page section:

"<HTML>
    <HEAD>
        <META http-equiv="Content-Type" content="text/html; charset=UTF-8">
        <meta name="format-detection" content="telephone=no">
        <META content="none" name="ROBOTS">
        <TITLE>Preview Window</TITLE>
        <link rel="stylesheet" href="/css/style_proj_info_simple.css" media="all" type="text/css">
        <meta http-equiv="X-UA-Compatible" content="IE=edge">
    </HEAD>
    <body style="color: white;">
        <div class="simple_preview_p">
            <div style="width:120px;"></div>
            <div id="images" style="border: 2px solid #ff0000; width:480px; height:304px; margin:10px auto; display:inline-block; background-color: #000000;"></div>
            <div style="width:120px; display:flex; align-items:center;">
                <div>
                    <button id="pre_btn" title="Pre-Show Mode" class="pre_btn_enable" onClick="preshow_stop()">Pre-Show Mode</button>
                </div>
            </div>
        </div>
        <script type="text/javascript">
            <!--
            URL = window.URL || window.webkitURL;
            var doc = document;
            var socket = new WebSocket('ws://' + location.hostname + ':8080','pj-cast-protocol');
            var img = new Image();
            var make_img = 0;
            var data = 0;
            var url = null;
            var text = doc.createElement('div');
            var make_text = 0;
            text.style.margin = '20px auto';
            var open_check = false;
            var refresh_f = 0;
            var refresh_wait_time = 1000;
            function monitor_refresh() {
                top.rightFrame.mainFrame.location.reload();
                refresh_f = 0;
            }
            ;function wait_monitor_refresh() {
                if (refresh_f == 0) {
                    setTimeout(monitor_refresh, refresh_wait_time);
                    refresh_f = 1
                }
            }
            ;socket.addEventListener('open', function(evt) {
                socket.send('start');
                open_check = true;
            }, false);
            socket.addEventListener('message', function(evt) {
                data = evt.data;
                if (data.constructor === Blob) {
                    if (url != null) {
                        URL.revokeObjectURL(url);
                    }
                    url = URL.createObjectURL(data);
                    img.src = url;
                    if (make_text === 1) {
                        doc.getElementById('images').removeChild(text);
                        make_text = 0;
                    }
                    if (make_img === 0) {
                        doc.getElementById('images').appendChild(img);
                        make_img = 1;
                    }
                } else if (data.constructor === String) {
                    if (data == 'HDCP') {
                        text.textContent = 'HDCP-protected content';
                        if (make_img === 1) {
                            doc.getElementById('images').removeChild(img);
                            make_img = 0;
                        }
                        if (make_text === 0) {
                            doc.getElementById('images').appendChild(text);
                            make_text = 1;
                        }
                    }
                    if (data == 'BLANK') {
                        if (make_img === 1) {
                            doc.getElementById('images').removeChild(img);
                            make_img = 0;
                        }
                    }
                    if (data == 'REFRESH') {
                        wait_monitor_refresh();
                    }
                    if (data == 'SIGNAL') {
                        top.rightFrame.mainFrame.statusFrameHidden.location.reload();
                    }
                    if (data == 'CHANGING_PRE') {
                        doc.getElementById('pre_btn').disabled = true;
                        doc.getElementById('pre_btn').style.cursor = 'wait';
                        doc.body.style.cursor = 'wait';
                    }
                }
            }, false);
            window.onbeforeunload = function(e) {
                socket.close();
            }
            ;
            function preshow_start() {
                socket.send('preshow:1');
            }
            ;function preshow_stop() {
                socket.send('preshow:0');
            }
            ;//-->
        </script>
    </BODY>
</HTML>
"

* Phase 3

Mostly adds built in functions and offers improved sorting to the commands list
Adds some easy of use imporvments

1. Double clicking on a projectors card should open that projectors web interface in a new tab on the users browser - a clckable icon on the tile is also acceptable

2. Input select comand needs improvment - we should handle this as 3 enum <slot number> <type> <input> example SLOT 1 SDI 1 note that AU1 = SLOT 1 and AU2 = SLOT 2
Inputs not tied to a slot should remain single items and restricted to only HDMI and Digital Link

3. Add START UP LOGO control + Query

4. Add BACK COLOR control + Query

4. Add SHUTTER SETTING-FADE IN control + Query 

5. Add SHUTTER SETTING-FADE OUT control + Query

6. Add ON SCREEN control + Query

7. Add QUAD PIXEL DRIVE control + Query

8. Add PROJECTION METHOD INSTALLATION +Query

9. Add OSD POSITION + Query

10. DAYLIGHT VIEW FRONT INSTALL + query

11. The command list will be quite long now and the user will need help navigating. A serch / filter should be added so a user can get to the command quickly. The list should be grouped by catagory as shown in the PDF. Queries should be grouped below the set comand. 

12. Add ip address of the server to the top of the page under the connected / not connected light

13. Add a pause / resume polling button, sending of commands are still allowed


* Phase 4

Quality of life improvments

1. When adding projectors using add range, add an automaticly increasing number to each name, exapmle 'projector 1' , 'projector 2', ...

2. Use natural sort order for the cards so they are arranged strictly numerically with out zero padding, example 1,2,... not 1,11,...

Items 1 and 2 are now completed. Testing item 1 surfaced that device names
had no duplicate guard at all (re-running "Add range" with the same prefix
silently created two identically-named devices) — fixed: create and
rename now reject a name already in use by another device.

* Post v1 improvments

From user feedback the following should be added

1. Preview window - add "Pre-show" all on / off buttons
2. Print human readable reponses from all built in query commands rather than just the raw response from the projector - Example query shutter fade in setting with QVX:SEFS1 returns SEFS1=3.0 present this to the user as "Shuter fade in value 3 seconds" 

Both items are now completed — see the "Post v1 improvements" section in
docs/PROGRESS.md.
