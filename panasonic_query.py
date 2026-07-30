## Panasonic 20K Temperature and Lamp Hours Querier
## By Bez 10 feb 2013
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
##insert the projector addresses here
pjs = ['131', '132', '133', '134', '141', '142', '143', '144', '147', '148', '151', '152', '153', '154', '161', '162', '163', '164', '171', '172', '181', '182', '183', '184', '185','186','187','188','189','190','191']

##File path for csv data:
path = '/Users/anthonybezencon/Desktop/'

t = time.strftime ('%d %b %H_%M')
filename = (path+t+'pjlog.csv')
f= open(filename, 'w')
f.write ('Projector log\n%s\nProjector Number,Temp,Lamp 1 Hours,Lamp 2 Hours,Lamp 3 Hours,Lamp 4 Hours\n' % (t))
f.close()

def connect():
        ##Setup the Socket and connect to the projector 
        global mySocket
        mySocket=socket.create_connection(address,5.0)
        mySocket.connect
        preamble = mySocket.recv(4096)
        authenticate = preamble.lstrip('NTCONTROL 1 ')
        ##Carry out the MD5 challenge
        authenticate = authenticate.rstrip('\r')
        m=('admin1:'+'panasonic:'+authenticate)
        global h
        h = hashlib.md5(m).hexdigest()

def tmpRead():

        cmd = '00QTM:0\r'   ### Temperature Query
        mySocket.send(h+cmd)
        temp = mySocket.recv(4096)
        temp = temp.lstrip('000')
        temp = temp.rstrip('\r')
        temp = temp[:-5]
        print ('Pj %s temp %s DegC' % (addr,temp))
        f = open(filename, 'a')
        f.write ('%s,%s,' % (addr,temp))
        f.close()
        

def lamphrs1():
        cmd = '00Q$L:1\r'   ### Lamp 1 hours Query
        mySocket.send(h+cmd)
        lamp1 = mySocket.recv(4096)
        lamp1 = lamp1.lstrip('000')
        lamp1 = lamp1.rstrip('\r')
        print ('Pj %s Lamp 1 %s Hours' % (addr,lamp1))
        f=open(filename, 'a')
        f.write( '%s,' % (lamp1))
        f.close()

def lamphrs2():
        cmd = '00Q$L:2\r'   ### Lamp 2 hours Query
        mySocket.send(h+cmd)
        lamp2 = mySocket.recv(4096)
        lamp2 = lamp2.lstrip('000')
        lamp2 = lamp2.rstrip('\r')
        print ('Pj %s Lamp 2 %s Hours' % (addr,lamp2))
        f=open(filename, 'a')
        f.write( '%s,' % (lamp2))
        f.close()

def lamphrs3():
        cmd = '00Q$L:3\r'   ### Lamp 3 hours Query
        mySocket.send(h+cmd)
        lamp3 = mySocket.recv(4096)
        lamp3 = lamp3.lstrip('000')
        lamp3 = lamp3.rstrip('\r')
        print ('Pj %s Lamp 3 %s Hours' % (addr,lamp3))
        f=open(filename, 'a')
        f.write( '%s,' % (lamp3))
        f.close()

def lamphrs4():
        cmd = '00Q$L:4\r'   ### Lamp 4 hours Query
        mySocket.send(h+cmd)
        lamp4 = mySocket.recv(4096)
        lamp4 = lamp4.lstrip('000')
        lamp4 = lamp4.rstrip('\r')
        print ('Pj %s Lamp 4 %s Hours' % (addr,lamp4))
        f=open(filename, 'a')
        f.write( '%s\n' % (lamp4))
        f.close()



for addr in pjs:
        try:

            global address
            address = ((host + addr),port)
            print 'Connecting....'
            connect()
            tmpRead()
            time.sleep(1)
            connect()
            lamphrs1()
            time.sleep(1)
            connect()
            lamphrs2()
            time.sleep(1)
            connect()
            lamphrs3()
            time.sleep(1)
            connect()
            lamphrs4()
            time.sleep(1)
        except Exception as e:
            print e


sys.exit
    
    

    
                    
                         
