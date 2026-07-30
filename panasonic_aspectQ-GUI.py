## Panasonic 20K Temperature and Lamp Hours Querier
## By Bez 10 feb 2013
from encodings import utf_8
import socket
import sys
import re
import hashlib
import string
import time
import PySimpleGUI as sg

sg.theme('DarkAmber')

layout = [  [sg.Text('Panasonic Control')],
            [sg.Text('Group Selection'),sg.Drop(values=('All', 'Road', 'Portals'),default_value=('All'),auto_size_text=True)],
            [sg.Button('HV Fit'), sg.Button('Set Light Output')],
            [sg.Button('OSD Off'), sg.Button('OSD On')],
            [sg.Button('Warning Off'), sg.Button('Warning On')],
            [sg.Button('Blue Off'), sg.Button('Logo Off'), sg.Button('User1'), sg.Button('Blending On'), sg.Button('Blending Off')],
            [sg.Push(),sg.Text('Green Balacne Low') , sg.InputText('255'), sg.Button('Set Low')],
            [sg.Push(),sg.Text('Green Balacne High') , sg.InputText('255'), sg.Button('Set High')], 
            [sg.Push(),sg.Text('Blending Top') , sg.InputText('0'), sg.Button('Set Top')],
            [sg.Push(),sg.Text('Blending Lower') , sg.InputText('255'), sg.Button('Set Lower')],
            
            
            [sg.Button('Quit')]]



window = sg.Window('HV FIT', layout)




## IP V4 prefeix (default 192.168.0.xxx)
host='192.168.0.'
## Port (default 1024)
port='1024'



def connect():
        ##Setup the Socket and connect to the projector 
        global mySocket
        mySocket=socket.create_connection(address,5.0)
        mySocket.connect
        preamble = mySocket.recv(4096)
        preamble = preamble.decode('utf_8')
        print (preamble)
        authenticate = preamble.lstrip('NTCONTROL 1 ')
        ##Carry out the MD5 challenge
        authenticate = authenticate.rstrip(' \r')
        
        m=('dispadmin:'+'@Panasonic:' + authenticate)
        m = m.encode()
        global h
        h = hashlib.md5(m).hexdigest()
        
def getGresponse():
        response = mySocket.recv(4096)
        response = response.decode('utf_8')
        response = response.rstrip('\r')
        sg.Print ('Response:', response)

def qAspect(addr):
    
        cmd = (h+'00QSE\r')   ### AR Query
        cmd = cmd.encode()
        mySocket.send(cmd)
        aspect = mySocket.recv(4096)
        aspect = aspect.decode('utf_8')
        aspect = aspect.rstrip('\r')
        if aspect == 'ERRA':
                sg.Print ('Connection Error')
                
        else: 
                sg.Print ('Pj %s Aspect Ratio %s' % (addr,aspect))
                if '006' not in aspect:
                        time.sleep(.2)
                        connect()
                        setAspect(addr)

def setAspect(addr):

        sg.Print ('Setting Aspect to HV Fit')
        cmd = (h+'00VSE:6\r')   ### AR Set to HV fit
        cmd = cmd.encode()
        mySocket.send(cmd)
        aspect = mySocket.recv(4096)
        aspect = aspect.decode('utf_8')
        aspect = aspect.rstrip('\r')
        sg.Print ('Pj %s Aspect Ratio %s' % (addr,aspect))

        
def getLightOp(addr):
        cmd = (h+'00QVX:LOPI2\r')   ### Q light OP
        mySocket.send(cmd)
        lightOp = mySocket.recv(4096)
##        aspect = aspect.lstrip('00')
        lightOp = lightOp.rstrip('\r')
        print ('Pj %s Light Output %s' % (addr,lightOp))

def setLightOp(addr):
        cmd = (h+'00VXX:LOPI2=+01000\r')   ### set light OP to 100pc
        cmd = cmd.encode()
        print(cmd)
        mySocket.send(cmd)
        lightOp = mySocket.recv(4096)
        lightOp = lightOp.decode('utf_8')
        lightOp = lightOp.rstrip('\r')
##        aspect = aspect.lstrip('00')
        lightOp = lightOp.rstrip('\r')
        sg.Print ('Pj %s Light Output %s' % (addr,lightOp))

def setPon(addr):
        cmd = ('00PON\r')   ### set Setpower on
        mySocket.send(cmd)
##        lightOp = mySocket.recv(4096)
####        aspect = aspect.lstrip('00')
##        lightOp = lightOp.rstrip('\r')
##        print ('Pj %s Light Output %s' % (addr,lightOp))

def getDyCon(addr):
        cmd = ('00QAI\r')   ### Query Dynamic Contrast
        mySocket.send(cmd)
        dyCon = mySocket.recv(4096)
##        dyCon = dyCon.lstrip('00')
        dyCon = dyCon.rstrip('\r')
        print ('Pj %s Dynamic Contrast %s' % (addr,dyCon))

def setDyCon(addr):
        cmd = ('00QAI:0\r')   ### Query Dynamic Contrast
        mySocket.send(cmd)
##        dyCon = mySocket.recv(4096)
####        dyCon = dyCon.lstrip('00')
##        dyCon = dyCon.rstrip('\r')
##        print ('Pj %s Dynamic Contrast %s' % (addr,dyCon))    

def blendOn(addr):
        cmd = (h+'00VXX:EDBI0=+00001\r')   ### Blending ON
        cmd = cmd.encode()
        mySocket.send(cmd)
        getGresponse()
        


def blendOff(addr):
        cmd = (h+'00VXX:EDBI0=+00000\r')   ### Blending ON
        cmd = cmd.encode()
        mySocket.send(cmd)
        getGresponse()

def blendLower(addr):
        cmd = (h+'00VGB:1\r')   ### Blending Lower ON
        cmd = cmd.encode()
        mySocket.send(cmd)
        getGresponse()
        connect()
        blendSizeLow(addr)
        

def blendSizeLow(addr):
        cmd = (h+'00VXX:EBWI0=+00'+ values[4]+'\r')   ### Blending ON
        cmd = cmd.encode()
        mySocket.send(cmd)
        getGresponse()

def blendUpper(addr):
        cmd = (h+'00VGU:1\r')   ### Blending Lower ON
        cmd= cmd.encode()
        mySocket.send(cmd)
        getGresponse()
        connect()
        blendSizeUp(addr)

def blendSizeUp(addr):
        cmd = (h+'00VXX:EUWI0=+0'+values[3] + '\r')   ### Blending ON
        cmd = cmd.encode()
        mySocket.send(cmd)
        getGresponse()

def blendRight(addr):
        cmd = (h+'00VGR:1\r')   ### Blending Lower ON
        mySocket.send(cmd)
        

def blendSizeRight(addr):
        cmd = (h+'00VXX:ERWI0=+00670\r')   ### Blending ON
        mySocket.send(cmd)
        
def blendLeft(addr):
        cmd = (h+'00VGL:1\r')   ### Blending Lower ON
        mySocket.send(cmd)

def blendSizeLeft(addr):
        cmd = (h+'00VXX:ELWI0=+00500\r')   ### Blending ON
        mySocket.send(cmd)

def blendMaker(addr):
        cmd = (h+'00VGM:0\r')   ### Blending ON
        mySocket.send(cmd)

def QSDIlevel(addr):
        cmd = ('00QVX:SSLI1\r') #Query SDI 1 Level
        mySocket.send(cmd)
        SDILevel = mySocket.recv(4096)
##         = dyCon.lstrip('00')
        SDILevel = SDILevel.rstrip('\r')
        print ('Pj %s SDI 1 Level 1 is %s' % (addr,SDILevel))
        
def OnScreenON(addr):
        cmd = (h+'00OOS:1\r')
        cmd = cmd.encode()
        mySocket.send(cmd)
        getGresponse()
        
def OnScreenOFF(addr):
        cmd = (h+'00OOS:0\r')
        cmd = cmd.encode()
        mySocket.send(cmd)
        getGresponse()
        
def warningOFF(addr):
        cmd = (h+'00VXX:WMDI0=+00000\r')
        cmd = cmd.encode()
        mySocket.send(cmd)
        getGresponse()

def warningON(addr):
        cmd = (h+'VXX:WMDI0=+00001\r')
        cmd = cmd.encode()
        mySocket.send(cmd)
        getGresponse()
        
def logoOFF(addr):
        cmd = (h+'00MLO:0\r')
        cmd = cmd.encode()
        mySocket.send(cmd)
        getGresponse()
        
def blueOFF(addr):
        cmd = (h+'00OBC:1\r')
        cmd = cmd.encode()
        mySocket.send(cmd)
        getGresponse()
        
def setGreenHigh(addr):
        cmd = (h+'00VHG:'+values[2]+'\r')
        print (cmd)
        cmd = cmd.encode()
        mySocket.send(cmd)
        wbGreen = mySocket.recv(4096)
        wbGreen = wbGreen.decode('utf_8')
        wbGreen = wbGreen.rstrip('\r')
        sg.Print ('Pj %s Green High: %s' % (addr,wbGreen))
        
def setGreenLow(addr):
        cmd = (h+'VOG:'+ values[1]+'\r')
        print (cmd)
        cmd = cmd.encode()
        mySocket.send(cmd)
        mySocket.send(cmd)
        wbGreen = mySocket.recv(4096)
        wbGreen = wbGreen.decode('utf_8')
        wbGreen = wbGreen.rstrip('\r')
        sg.Print ('Pj %s Green Low: %s' % (addr,wbGreen))
        
        
def setUser1CT(add):
        cmd = (h+'OTE:04\r')
        cmd = cmd.encode()
        mySocket.send(cmd)
        getGresponse()

        
def clicked():      
         roadPjs = ['101', '102', '103', '104', '105', '106', '107', '108', '109', '110', '111', '112', '113', '114', '115', '116', '117', '118', '119', '120', '121', '122', '123', '124'] #end of road projectors
            
         portalPjs = ['131','132','133','134','137', '138', '139', '140', '151', '154', '155', '156', '158', '159', '160', '161']
        
         if values[0] == 'All':
                pjs = roadPjs + portalPjs
         if values[0] == 'Road':
                 pjs = roadPjs
         if values[0] == 'Portals':
                pjs = portalPjs
        
        
         for addr in pjs:
                 try:
               
                        global address
                        addr = str(addr)
                        address = ((host + addr),port)
                        sg.Print ('Connecting to projector %s' % (addr))
                        connect()
                        if event == 'HV Fit':
                                 qAspect(addr)
                        if event == 'OSD Off':
                                OnScreenOFF(addr)
                        if event == 'OSD On':
                                OnScreenON(addr)
                        if event == 'Warning Off':
                                warningOFF(addr)                               
                        if event == 'Warning On':
                                warningON(addr)
                        if event == 'Blue Off':
                                blueOFF(addr)
                        if event == 'Logo Off':
                                logoOFF(addr)
                        if event == 'Set Light Output':
                                setLightOp(addr)
                        if event == 'Set Low':
                                setGreenLow(addr)     
                        if event == 'Set High':
                                setGreenHigh(addr)
                        if event == 'User1':
                                setUser1CT(addr)
                        if event == 'Blending On':
                                blendOn(addr)
                        if event == 'Blending Off':
                                blendOff(addr)
                        if event == 'Set Top':
                                blendUpper(addr)
                        if event == 'Set Lower':
                                blendLower(addr)
                                
                       
                        time.sleep(.2)


                 except Exception as e:
                        sg.Print (e)
  
               


                                
                
                        

                    
         sg.Print('Finished, press quit to close this window')

        
while True:
    event, values = window.read()
    if event == sg.WIN_CLOSED or event == 'Quit': # if user closes window or clicks cancel
        break
    
    print(f'You clicked {event}')
    print(values)
    clicked()

            
    if event == sg.WIN_CLOSED or event == 'Quit': # if user closes window or clicks cancel
        break

   # main()

window.close()
    
    

    
                    
                         
