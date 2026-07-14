"""
Extract emails from New Outlook's local IndexedDB cache.
Usage: python extract_outlook.py [--folders] [--messages <folder_id>] [--body <item_id>] [--all-messages]
Output: JSON to stdout
"""
import pathlib
import json
import sys
import os

def get_profile_path():
    return pathlib.Path.home() / "AppData/Local/Microsoft/Olk/EBWebView/Default"

def find_db(profile):
    idb = profile.get_indexeddb("https_outlook.office.com_0")
    for db_id in idb.database_ids:
        if 'owa-offline-data-' in db_id.name:
            db = idb[db_id]
            if db.object_store_count > 5:
                store = db.get_object_store_by_name("messages")
                for r in store.iterate_records():
                    return db
    return None

def serialize(val):
    if val is None:
        return None
    if isinstance(val, dict):
        return {k: serialize(v) for k, v in val.items()}
    if isinstance(val, list):
        return [serialize(v) for v in val]
    if isinstance(val, (str, int, float, bool)):
        return val
    s = str(val)
    if s == '<Undefined>':
        return None
    return s

def extract_folders(db):
    store = db.get_object_store_by_name("folders")
    folders = []
    for record in store.iterate_records():
        val = record.value
        if not isinstance(val, dict):
            continue
        fid = str(val.get('id', ''))
        dn = str(val.get('displayName', '') or '')
        dtype = str(val.get('distinguishedFolderType', '') or '')
        folders.append({
            'id': fid,
            'displayName': dn,
            'type': dtype,
            'unreadCount': val.get('UnreadCount', 0) or 0,
            'totalCount': val.get('totalMessageCount', 0) or 0,
        })
    # Deduplicate by id
    seen = set()
    unique = []
    for f in folders:
        if f['id'] not in seen:
            seen.add(f['id'])
            unique.append(f)
    return unique

def extract_messages(db, folder_id=None):
    store = db.get_object_store_by_name("messages")
    messages = []
    for record in store.iterate_records():
        val = record.value
        if not isinstance(val, dict):
            continue
        
        parent = val.get('ParentFolderId', {})
        parent_id = parent.get('Id', '') if isinstance(parent, dict) else ''
        
        if folder_id and parent_id != folder_id:
            continue
        
        from_data = val.get('From', {})
        from_str = ''
        if isinstance(from_data, dict):
            mb = from_data.get('Mailbox', {})
            if isinstance(mb, dict):
                name = mb.get('Name', '')
                email = mb.get('EmailAddress', '')
                from_str = f"{name} <{email}>" if name else email

        item_id_data = val.get('ItemId', {})
        item_id = item_id_data.get('Id', '') if isinstance(item_id_data, dict) else str(val.get('id', ''))

        messages.append({
            'itemId': item_id,
            'subject': str(val.get('Subject', '') or ''),
            'from': from_str,
            'to': str(val.get('DisplayTo', '') or ''),
            'date': str(val.get('DateTimeReceived', '') or ''),
            'dateSent': str(val.get('DateTimeSent', '') or ''),
            'preview': str(val.get('Preview', '') or ''),
            'isRead': bool(val.get('IsRead', False)),
            'isDraft': bool(val.get('IsDraft', False)),
            'hasAttachments': bool(val.get('HasAttachments', False)),
            'importance': str(val.get('Importance', 'Normal') or 'Normal'),
            'parentFolderId': parent_id,
            'size': val.get('Size', 0),
        })
    return messages

def extract_body(db, item_id):
    store = db.get_object_store_by_name("messageBodies")
    for record in store.iterate_records():
        val = record.value
        if not isinstance(val, dict):
            continue
        
        iid = val.get('ItemId', {})
        rid = iid.get('Id', '') if isinstance(iid, dict) else str(val.get('id', ''))
        
        if rid != item_id:
            continue
        
        body = val.get('UniqueBody', {})
        html = ''
        text = ''
        if isinstance(body, dict):
            if body.get('BodyType') == 'HTML':
                html = body.get('Value', '')
            else:
                text = body.get('Value', '')
        
        subject = str(val.get('Subject', '') or '')
        
        from_data = val.get('From', val.get('Sender', {}))
        from_str = ''
        if isinstance(from_data, dict):
            mb = from_data.get('Mailbox', {})
            if isinstance(mb, dict):
                name = mb.get('Name', '')
                email = mb.get('EmailAddress', '')
                from_str = f"{name} <{email}>" if name else email

        to_list = val.get('ToRecipients', [])
        to_str = ''
        if isinstance(to_list, list):
            parts = []
            for t in to_list:
                if isinstance(t, dict):
                    n = t.get('Name', '')
                    e = t.get('EmailAddress', '')
                    parts.append(f"{n} <{e}>" if n else e)
            to_str = ', '.join(parts)

        return {
            'itemId': rid,
            'subject': subject,
            'from': from_str,
            'to': to_str,
            'html': html,
            'text': text,
            'date': str(val.get('DateTimeReceived', '') or ''),
            'internetMessageId': str(val.get('InternetMessageId', '') or ''),
        }
    return None

def main():
    from ccl_chromium_reader import ChromiumProfileFolder
    
    profile_path = get_profile_path()
    if not profile_path.exists():
        print(json.dumps({'error': 'New Outlook profile not found'}))
        sys.exit(1)
    
    with ChromiumProfileFolder(profile_path) as profile:
        db = find_db(profile)
        if not db:
            print(json.dumps({'error': 'No Outlook data found'}))
            sys.exit(1)
        
        if len(sys.argv) < 2:
            print(json.dumps({'error': 'Usage: --folders | --messages <folder_id> | --all-messages | --body <item_id>'}))
            sys.exit(1)
        
        cmd = sys.argv[1]
        
        if cmd == '--folders':
            result = extract_folders(db)
            print(json.dumps(result, ensure_ascii=False))
        
        elif cmd == '--messages':
            fid = sys.argv[2] if len(sys.argv) > 2 else None
            result = extract_messages(db, fid)
            print(json.dumps(result, ensure_ascii=False))
        
        elif cmd == '--all-messages':
            result = extract_messages(db)
            print(json.dumps(result, ensure_ascii=False))
        
        elif cmd == '--body':
            if len(sys.argv) < 3:
                print(json.dumps({'error': 'item_id required'}))
                sys.exit(1)
            result = extract_body(db, sys.argv[2])
            print(json.dumps(result, ensure_ascii=False) if result else json.dumps(None))
        
        else:
            print(json.dumps({'error': f'Unknown command: {cmd}'}))
            sys.exit(1)

if __name__ == '__main__':
    main()
