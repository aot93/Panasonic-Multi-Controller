## Panasonic 20K Temperature and Lamp Hours Querier
## By Bez 10 feb 2013
from encodings import utf_8
import socket
import sys
import re
import hashlib
import string
import time

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
        ##print (preamble)
        authenticate = preamble.lstrip('NTCONTROL 1 ')
        ##Carry out the MD5 challenge
        authenticate = authenticate.rstrip(' \r')
        
        m=('dispadmin:'+'@Panasonic:' + authenticate)
        m = m.encode()
        global h
        h = hashlib.md5(m).hexdigest()

def qAspect(addr):
    
        cmd = (h+'00QSE\r')   ### AR Query
        cmd = cmd.encode()
        mySocket.send(cmd)
        aspect = mySocket.recv(4096)
        aspect = aspect.decode('utf_8')
        aspect = aspect.rstrip('\r')
        if aspect == 'ERRA':
                print ('Connection Error')
                
        else: 
                print ('Pj %s Aspect Ratio %s' % (addr,aspect))
                if '006' not in aspect:
                        time.sleep(.2)
                        connect()
                        setAspect(addr)

def setAspect(addr):

        print ('Setting Aspect to HV Fit')
        cmd = (h+'00VSE:6\r')   ### AR Set to HV fit
        cmd = cmd.encode()
        mySocket.send(cmd)
        aspect = mySocket.recv(4096)
        aspect = aspect.decode('utf_8')
        aspect = aspect.rstrip('\r')
        print ('Pj %s Aspect Ratio %s' % (addr,aspect))
        
def getScreenSetting(addr):
        cmd = (h+'00QSF\r')   ### AR Query
        cmd = cmd.encode()
        mySocket.send(cmd)
        aspect = mySocket.recv(4096)
        aspect = aspect.decode('utf_8')
        aspect = aspect.rstrip('\r')
        if aspect == 'ERRA':
                print ('Connection Error')
                
        else: 
                print ('Pj %s Screen Setting  %s' % (addr,aspect))
                if '000' not in aspect:
                        time.sleep(.2)
                        connect()
                        setScreenSetting(addr)
                        
def setScreenSetting(addr):
        print ('Setting Screen to 16:10')
        cmd = (h+'00VSF:0\r')   ### Screen set to 16:109
        cmd = cmd.encode()
        mySocket.send(cmd)
        aspect = mySocket.recv(4096)
        aspect = aspect.decode('utf_8')
        aspect = aspect.rstrip('\r')
        print ('Pj %s Screen Setting %s' % (addr,aspect))


        
def getLightOp(addr):
        cmd = (h+'00QVX:LOPI2\r')   ### Q light OP
        mySocket.send(cmd)
        lightOp = mySocket.recv(4096)
##        aspect = aspect.lstrip('00')
        lightOp = lightOp.rstrip('\r')
        print ('Pj %s Light Output %s' % (addr,lightOp))

def setLightOp(addr):
        cmd = (h+'00VXX:LOPI2=+01000\r')   ### set light OP to 100pc
        mySocket.send(cmd)
        lightOp = mySocket.recv(4096)
##        aspect = aspect.lstrip('00')
        lightOp = lightOp.rstrip('\r')
        print ('Pj %s Light Output %s' % (addr,lightOp))

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
        cmd = ('00VXX:EDBI0=+00001\r')   ### Blending ON
        mySocket.send(cmd)

def blendLower(addr):
        cmd = ('00VGB:1\r')   ### Blending Lower ON
        mySocket.send(cmd)

def blendSize(addr):
        cmd = ('00VXX:EBWI0=+00230\r')   ### Blending ON
        mySocket.send(cmd)

def blendUpper(addr):
        cmd = ('00VGU:1\r')   ### Blending Lower ON
        mySocket.send(cmd)

def blendSizeUp(addr):
        cmd = ('00VXX:EUWI0=+00230\r')   ### Blending ON
        mySocket.send(cmd)

def blendRight(addr):
        cmd = ('00VGR:1\r')   ### Blending Lower ON
        mySocket.send(cmd)

def blendSizeRight(addr):
        cmd = ('00VXX:ERWI0=+00670\r')   ### Blending ON
        mySocket.send(cmd)
        
def blendLeft(addr):
        cmd = ('00VGL:1\r')   ### Blending Lower ON
        mySocket.send(cmd)

def blendSizeLeft(addr):
        cmd = ('00VXX:ELWI0=+00500\r')   ### Blending ON
        mySocket.send(cmd)

def blendMaker(addr):
        cmd = ('00VGM:0\r')   ### Blending ON
        mySocket.send(cmd)

def QSDIlevel(addr):
        cmd = ('00QVX:SSLI1\r') #Query SDI 1 Level
        mySocket.send(cmd)
        SDILevel = mySocket.recv(4096)
##         = dyCon.lstrip('00')
        SDILevel = SDILevel.rstrip('\r')
        print ('Pj %s SDI 1 Level 1 is %s' % (addr,SDILevel))
        
def main():      
         pjs = ['11', '12', '13', '14', '15', '15', '16', '17', '18', '19', '21', '22', '23', '24', '31', '32', '41', '42', '51', '52', '53', '54', '55', '56', '57','58','59','60','61','62','63', '64']      
         for addr in pjs:  
                 try:

                        global address
                        addr = str(addr)
                        address = ((host + addr),port)
                        print ('Connecting to projector %s' % (addr))
                        connect()
                ##            blendOn(addr)
                ##            time.sleep(.2)
                ##            connect()
                ##            blendLower(addr)
                ##            time.sleep(.2)
                ##            connect()
                ##            blendSize(addr)
                ##            time.sleep(.2)
                ##            connect()
                ##            blendUpper(addr)
                ##            time.sleep(.2)
                ##            connect()
                ##            blendSizeUp(addr)
                ##            time.sleep(.2)
                ##            connect()
                ##            blendRight(addr)
                ##            time.sleep(.2)
                ##            connect()
                ##            blendSizeRight(addr)
                ##            connect()
                ##            blendLeft(addr)
                ##            time.sleep(.2)
                ##            connect()
                ##            blendSizeLeft(addr)
                ##            blendMarker(addr)
                ##            setDyCon(addr)
                ##            setPon(addr)
                ##            connect()
                ##            QSDIlevel(addr)
                ##            time.sleep(.2)
                        
                ##            connect()
                        qAspect(addr)
                        time.sleep(.2)
                        
                        #     connect()
                        #     getLightOp(addr)
                        #     mySocket.close()
                        #     time.sleep(.2)

                 except Exception as e:
                        print (e)
         finished = input('Finished Press x to quit, r to resend..:')
         if  "x" in finished:
                sys.exit()
         if "r" in finished:
                main()
        
main()
    
    

    
                    
                         
