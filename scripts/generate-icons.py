"""Generate native PNG app icons from geometric paths. No external image dependencies."""
import struct, zlib
from pathlib import Path

def icon(size):
    # 4x supersampling for clean antialiasing; a simple book mark on system blue.
    scale=3
    n=size*scale
    pixels=bytearray(n*n*3)
    blue=(8,120,239)
    def distance(x,y,x1,y1,x2,y2):
        dx,dy=x2-x1,y2-y1
        t=max(0,min(1,((x-x1)*dx+(y-y1)*dy)/(dx*dx+dy*dy)))
        return ((x-(x1+t*dx))**2+(y-(y1+t*dy))**2)**.5
    segments=[(155,155,337,155),(337,155,354,174),(354,174,354,351),(354,351,337,370),(337,370,177,370),(177,370,155,347),(155,347,155,155),(155,311,354,311),(214,213,291,213),(214,260,262,260)]
    for y in range(n):
        for x in range(n):
            px,py=(x+.5)*512/n,(y+.5)*512/n
            white=any(distance(px,py,*s)<12 for s in segments)
            pos=(y*n+x)*3
            pixels[pos:pos+3]=bytes((255,255,255) if white else blue)
    raw=bytearray()
    for y in range(size):
        raw.append(0)
        for x in range(size):
            for c in range(3):
                raw.append(round(sum(pixels[((y*scale+yy)*n+x*scale+xx)*3+c] for yy in range(scale) for xx in range(scale))/(scale*scale)))
    def chunk(t,d):return struct.pack('>I',len(d))+t+d+struct.pack('>I',zlib.crc32(t+d)&0xffffffff)
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',size,size,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(raw))+chunk(b'IEND',b'')

root=Path(__file__).resolve().parents[1]/'public'
for size,name in [(180,'apple-touch-icon.png'),(192,'icon-192.png'),(512,'icon-512.png')]:
    (root/name).write_bytes(icon(size))
    print(name)
