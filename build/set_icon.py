#!/usr/bin/env python3
"""
Set icon on a Windows PE executable - pure Python implementation.
Properly constructs PE icon resources (RT_GROUP_ICON + RT_ICON) without wine/rcedit.
"""
import sys, struct

def read_ico(ico_path):
    with open(ico_path, 'rb') as f:
        data = f.read()
    reserved, ico_type, count = struct.unpack_from('<HHH', data, 0)
    if reserved != 0 or ico_type != 1:
        raise ValueError("Not a valid ICO file")
    entries, images = [], []
    for i in range(count):
        off = 6 + i * 16
        w, h, colors, r2, planes, bitcount, size, img_off = struct.unpack_from('<BBBBHHII', data, off)
        entries.append((w, h, colors, r2, planes, bitcount, size, i + 1))
        images.append((i + 1, data[img_off:img_off + size]))
    group_dir = struct.pack('<HHH', 0, 1, count)
    for w, h, c, r2, p, b, s, iid in entries:
        group_dir += struct.pack('<BBBBHHIH', w, h, c, r2, p, b, s, iid)
    return group_dir, images

def align_up(value, alignment):
    return (value + alignment - 1) & ~(alignment - 1)

def set_icon(exe_path, ico_path, output_path=None):
    group_dir, images = read_ico(ico_path)
    print(f"ICO: {len(images)} icons, group dir size={len(group_dir)}")

    with open(exe_path, 'rb') as f:
        exe_data = bytearray(f.read())

    pe_offset = struct.unpack_from('<I', exe_data, 0x3C)[0]
    coff_offset = pe_offset + 4
    _, num_sections, _, _, _, opt_header_size, _ = struct.unpack_from('<HHIIIHH', exe_data, coff_offset)
    opt_offset = coff_offset + 20
    magic = struct.unpack_from('<H', exe_data, opt_offset)[0]
    is_pe32plus = (magic == 0x20B)
    dd_offset = opt_offset + (112 if is_pe32plus else 96)
    resource_rva = struct.unpack_from('<I', exe_data, dd_offset + 16)[0]
    file_alignment = struct.unpack_from('<I', exe_data, opt_offset + (36 if is_pe32plus else 36))[0]
    section_alignment = struct.unpack_from('<I', exe_data, opt_offset + (32 if is_pe32plus else 32))[0]
    sizeofimage_off = opt_offset + (56 if is_pe32plus else 60)

    sections_offset = opt_offset + opt_header_size
    sections = []
    for i in range(num_sections):
        so = sections_offset + i * 40
        name = exe_data[so:so+8].rstrip(b'\x00')
        vsize, vaddr, raw_size, raw_offset, _, _, _, _, _ = struct.unpack_from('<IIIIIIHHI', exe_data, so + 8)
        sections.append({'name': name, 'vaddr': vaddr, 'vsize': vsize, 'raw_offset': raw_offset, 'raw_size': raw_size, 'header_offset': so})

    rsrc_sec = None
    for s in sections:
        if s['vaddr'] <= resource_rva < s['vaddr'] + max(s['vsize'], s['raw_size']):
            rsrc_sec = s
            break
    rsrc_base, rsrc_vbase = rsrc_sec['raw_offset'], rsrc_sec['vaddr']

    def rva_to_off(rva):
        for s in sections:
            if s['vaddr'] <= rva < s['vaddr'] + max(s['vsize'], s['raw_size']):
                return s['raw_offset'] + (rva - s['vaddr'])
        return None

    def off_to_rva(off):
        for s in sections:
            if s['raw_offset'] <= off < s['raw_offset'] + s['raw_size']:
                return s['vaddr'] + (off - s['raw_offset'])
        return None

    def read_dir_entries(dir_rel):
        doff = rsrc_base + dir_rel
        _, _, _, _, nn, ni = struct.unpack_from('<IIHHHH', exe_data, doff)
        for i in range(nn + ni):
            eoff = doff + 16 + i * 8
            nid, dod = struct.unpack_from('<II', exe_data, eoff)
            if nid & 0x80000000: continue
            is_dir = bool(dod & 0x80000000)
            child_rel = dod & 0x7FFFFFFF
            yield (nid & 0xFFFF, is_dir, child_rel)

    RT_ICON, RT_GROUP_ICON = 3, 14
    group_icon_res, icon_resources = None, {}
    root_rel = resource_rva - rsrc_vbase

    for type_id, is_dir, type_rel in read_dir_entries(root_rel):
        if not is_dir: continue
        if type_id == RT_GROUP_ICON:
            for name_id, nd, name_rel in read_dir_entries(type_rel):
                if not nd: continue
                for lang_id, ld, lang_rel in read_dir_entries(name_rel):
                    if ld: continue
                    de_off = rsrc_base + lang_rel
                    drva, dsize, _, _ = struct.unpack_from('<IIII', exe_data, de_off)
                    if group_icon_res is None or name_id == 1:
                        group_icon_res = {'name_id': name_id, 'data_rva': drva, 'data_size': dsize, 'de_offset': de_off, 'data_offset': rva_to_off(drva)}
        elif type_id == RT_ICON:
            for name_id, nd, name_rel in read_dir_entries(type_rel):
                if not nd: continue
                for lang_id, ld, lang_rel in read_dir_entries(name_rel):
                    if ld: continue
                    de_off = rsrc_base + lang_rel
                    drva, dsize, _, _ = struct.unpack_from('<IIII', exe_data, de_off)
                    icon_resources[name_id] = {'data_rva': drva, 'data_size': dsize, 'de_offset': de_off, 'data_offset': rva_to_off(drva)}

    if not group_icon_res:
        print("ERROR: No RT_GROUP_ICON found!")
        return False

    print(f"Group icon: RVA=0x{group_icon_res['data_rva']:x}, size={group_icon_res['data_size']}")
    print(f"RT_ICON slots: {sorted(icon_resources.keys())}")

    if len(images) > len(icon_resources):
        print(f"Limiting to {len(icon_resources)} icons")
        images = images[:len(icon_resources)]
        with open(ico_path, 'rb') as f:
            ico_data = f.read()
        count = len(images)
        group_dir = struct.pack('<HHH', 0, 1, count)
        for i in range(count):
            eo = 6 + i * 16
            w, h, c, r2, p, b, s, _ = struct.unpack_from('<BBBBHHII', ico_data, eo)
            group_dir += struct.pack('<BBBBHHIH', w, h, c, r2, p, b, s, i + 1)

    all_entries = [group_icon_res] + list(icon_resources.values())
    max_used = max(de['data_offset'] + de['data_size'] for de in all_entries)
    rsrc_raw_end = rsrc_sec['raw_offset'] + rsrc_sec['raw_size']
    free_space = rsrc_raw_end - max_used
    total_needed = len(group_dir) + sum(len(img) for _, img in images)
    print(f"Free space: {free_space}, needed: {total_needed}")

    append = free_space < total_needed
    write_base = rsrc_raw_end if append else max_used
    current_write = write_base

    def ensure_space(n):
        nonlocal current_write, exe_data
        while len(exe_data) < current_write + n:
            exe_data.append(0)

    def write_new_data(data):
        nonlocal current_write
        ensure_space(len(data))
        exe_data[current_write:current_write+len(data)] = data
        rva = off_to_rva(current_write)
        if rva is None:
            rva = rsrc_vbase + (current_write - rsrc_sec['raw_offset'])
        current_write = align_up(current_write + len(data), 8)
        return rva, len(data)

    if len(group_dir) <= group_icon_res['data_size']:
        doff = group_icon_res['data_offset']
        exe_data[doff:doff+len(group_dir)] = group_dir
        for i in range(len(group_dir), group_icon_res['data_size']):
            exe_data[doff + i] = 0
        struct.pack_into('<I', exe_data, group_icon_res['de_offset'] + 4, len(group_dir))
        print("Group dir overwritten in place")
    else:
        nrva, ns = write_new_data(group_dir)
        struct.pack_into('<I', exe_data, group_icon_res['de_offset'], nrva)
        struct.pack_into('<I', exe_data, group_icon_res['de_offset'] + 4, ns)
        print(f"Group dir moved to RVA 0x{nrva:x}")

    for icon_id, img_data in images:
        if icon_id in icon_resources:
            ir = icon_resources[icon_id]
            if len(img_data) <= ir['data_size']:
                doff = ir['data_offset']
                exe_data[doff:doff+len(img_data)] = img_data
                for i in range(len(img_data), ir['data_size']):
                    exe_data[doff + i] = 0
                struct.pack_into('<I', exe_data, ir['de_offset'] + 4, len(img_data))
                print(f"  Icon {icon_id}: overwritten ({len(img_data)} bytes)")
            else:
                nrva, ns = write_new_data(img_data)
                struct.pack_into('<I', exe_data, ir['de_offset'], nrva)
                struct.pack_into('<I', exe_data, ir['de_offset'] + 4, ns)
                print(f"  Icon {icon_id}: moved to RVA 0x{nrva:x} ({len(img_data)} bytes)")

    if append:
        new_used = current_write - rsrc_sec['raw_offset']
        new_raw = align_up(new_used, file_alignment)
        hdr = rsrc_sec['header_offset']
        struct.pack_into('<I', exe_data, hdr + 16, new_raw)
        struct.pack_into('<I', exe_data, hdr + 8, new_used)
        while len(exe_data) < rsrc_sec['raw_offset'] + new_raw:
            exe_data.append(0)
        new_img = align_up(rsrc_sec['vaddr'] + new_raw, section_alignment)
        old_img = struct.unpack_from('<I', exe_data, sizeofimage_off)[0]
        if new_img > old_img:
            struct.pack_into('<I', exe_data, sizeofimage_off, new_img)
            print(f"SizeOfImage: 0x{old_img:x} -> 0x{new_img:x}")

    out = output_path or exe_path
    with open(out, 'wb') as f:
        f.write(exe_data)
    print(f"Done: {out} ({len(exe_data)} bytes)")
    return True

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print(f"Usage: {sys.argv[0]} <exe> <ico> [output]")
        sys.exit(1)
    out = sys.argv[3] if len(sys.argv) > 3 else None
    sys.exit(0 if set_icon(sys.argv[1], sys.argv[2], out) else 1)