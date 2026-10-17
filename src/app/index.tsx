import AsyncStorage from '@react-native-async-storage/async-storage';
import DateTimePicker, { DateTimePickerAndroid, DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Directory, File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import * as Notifications from 'expo-notifications';
import { useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type PhotoKind = 'receipt' | 'manual' | 'other';

// One saved photo. We store just the file name; the folder is rebuilt each time.
type Photo = { file: string; kind: PhotoKind };

// One appliance you own.
type Appliance = {
  id: string;
  name: string;
  store: string;
  purchaseDate: string; // YYYY-MM-DD
  warrantyMonths: number;
  remindDays?: number; // how many days before the end to remind you
  notificationIds?: string[]; // the reminders scheduled on the phone
  photos?: Photo[];
};

const STORAGE_KEY = 'appliances';
const MONTH_OPTIONS = [12, 24, 36, 60];
const REMIND_OPTIONS = [7, 14, 30, 60];
const REMINDER_HOUR = 9; // reminders go off at 9:00 AM
const KIND_LABELS: Record<PhotoKind, string> = { receipt: 'Receipt', manual: 'Manual', other: 'Other' };

// ---------- photo files ----------

// A folder inside the app's own storage, so photos stay even if you delete them from your camera roll.
function photoFolder() {
  const dir = new Directory(Paths.document, 'photos');
  if (!dir.exists) dir.create();
  return dir;
}
function photoUri(p: Photo) {
  return new File(photoFolder(), p.file).uri;
}
// Copy a picked photo into the app's folder and return its new file name.
function keepPhoto(pickedUri: string) {
  const name = `${Date.now()}-${Math.round(Math.random() * 1e6)}.jpg`;
  new File(pickedUri).copy(new File(photoFolder(), name));
  return name;
}
function removePhotoFile(p: Photo) {
  try {
    const f = new File(photoFolder(), p.file);
    if (f.exists) f.delete();
  } catch {
    // Already gone; nothing to do.
  }
}

// ---------- reminders ----------

// Show reminders as a banner even while the app is open.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// A date as YYYY-MM-DD in your own time zone.
function toDateString(d: Date) {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}
function todayString() {
  return toDateString(new Date());
}
// Turn YYYY-MM-DD back into a Date (local time, not UTC).
function fromDateString(s: string) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// The day the warranty runs out.
function endDate(a: Appliance) {
  const [y, m, d] = a.purchaseDate.split('-').map(Number);
  return new Date(y, m - 1 + a.warrantyMonths, d);
}

// Whole days from today until the warranty ends (negative = already ended).
function daysLeft(a: Appliance) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((endDate(a).getTime() - today.getTime()) / 86400000);
}

function statusFor(a: Appliance) {
  const days = daysLeft(a);
  if (days < 0) return { label: 'Expired', color: '#b3261e' };
  if (days <= (a.remindDays ?? 30)) return { label: `${days} days left`, color: '#b26a00' };
  if (days < 60) return { label: `${days} days left`, color: '#1d7a4a' };
  return { label: `${Math.round(days / 30.4)} months left`, color: '#1d7a4a' };
}

// Ask once for permission to send notifications. Returns true if allowed.
async function askPermission() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('reminders', {
      name: 'Warranty reminders',
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted;
}

// Schedule one notification at a given date. Skips dates already in the past.
async function scheduleAt(date: Date, title: string, body: string) {
  if (date.getTime() <= Date.now()) return null;
  return Notifications.scheduleNotificationAsync({
    content: { title, body },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date, channelId: 'reminders' },
  });
}

// Schedule both reminders for an appliance and return their ids.
async function scheduleReminders(a: Appliance) {
  const end = endDate(a);
  end.setHours(REMINDER_HOUR, 0, 0, 0);
  const early = new Date(end);
  early.setDate(early.getDate() - (a.remindDays ?? 30));

  const ids: string[] = [];
  const first = await scheduleAt(
    early,
    `${a.name} warranty ends in ${a.remindDays ?? 30} days`,
    `Coverage ends ${end.toLocaleDateString()}. Check it over now in case anything needs a repair claim.`
  );
  if (first) ids.push(first);
  const last = await scheduleAt(
    end,
    `${a.name} warranty ends today`,
    a.store ? `Bought from ${a.store}. Last day to make a warranty claim.` : 'Last day to make a warranty claim.'
  );
  if (last) ids.push(last);
  return ids;
}

async function cancelReminders(a: Appliance) {
  for (const id of a.notificationIds ?? []) {
    await Notifications.cancelScheduledNotificationAsync(id);
  }
}

// ---------- screen ----------

export default function HomeScreen() {
  const [items, setItems] = useState<Appliance[]>([]);
  const [showForm, setShowForm] = useState(false);

  // Form fields
  const [name, setName] = useState('');
  const [store, setStore] = useState('');
  const [date, setDate] = useState(todayString());
  const [months, setMonths] = useState(12);
  const [remindDays, setRemindDays] = useState(30);

  // Detail screen
  const [openId, setOpenId] = useState<string | null>(null);
  const [photoKind, setPhotoKind] = useState<PhotoKind>('receipt');
  const [viewing, setViewing] = useState<Photo | null>(null);
  const open = items.find((i) => i.id === openId) ?? null;

  // Load saved appliances when the app opens.
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      if (raw) setItems(JSON.parse(raw));
    });
  }, []);

  // Update the list on screen and save it to the phone.
  async function saveList(next: Appliance[]) {
    const sorted = [...next].sort((x, y) => endDate(x).getTime() - endDate(y).getTime());
    setItems(sorted);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(sorted));
  }

  async function addAppliance() {
    if (!name.trim()) {
      Alert.alert('Add a name', 'What appliance is this? For example: Dishwasher.');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      Alert.alert('Check the date', 'Use the format YYYY-MM-DD, like 2026-03-15.');
      return;
    }
    const appliance: Appliance = {
      id: Date.now().toString(),
      name: name.trim(),
      store: store.trim(),
      purchaseDate: date,
      warrantyMonths: months,
      remindDays,
      notificationIds: [],
      photos: [],
    };

    const allowed = await askPermission();
    if (allowed) {
      appliance.notificationIds = await scheduleReminders(appliance);
    }
    await saveList([...items, appliance]);

    setName('');
    setStore('');
    setDate(todayString());
    setMonths(12);
    setRemindDays(30);
    setShowForm(false);

    // Tell the person what happened with the reminders.
    const count = appliance.notificationIds?.length ?? 0;
    if (!allowed) {
      Alert.alert('Saved without reminders', 'Notifications are turned off for Expo Go. Turn them on in your phone settings to get reminders.');
    } else if (count === 0) {
      Alert.alert('Saved', 'This warranty has already ended, so no reminders were set.');
    } else {
      Alert.alert('Saved', count === 2 ? 'You will get a reminder before the warranty ends and another on the last day.' : 'The early reminder date has passed, so you will get one reminder on the last day.');
    }
  }

  function deleteAppliance(a: Appliance) {
    Alert.alert(`Delete ${a.name}?`, 'This removes it, its photos, and its reminders.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await cancelReminders(a);
          (a.photos ?? []).forEach(removePhotoFile);
          setOpenId(null);
          await saveList(items.filter((i) => i.id !== a.id));
        },
      },
    ]);
  }

  // Take a new photo, or pick one from the library, and attach it to the open appliance.
  async function addPhoto(source: 'camera' | 'library') {
    if (!open) return;
    let result: ImagePicker.ImagePickerResult;
    if (source === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Camera is off', 'Allow camera access for Expo Go in your phone settings to take photos.');
        return;
      }
      result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7 });
    } else {
      result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    }
    if (result.canceled || !result.assets?.length) return;

    try {
      const file = keepPhoto(result.assets[0].uri);
      const updated = { ...open, photos: [...(open.photos ?? []), { file, kind: photoKind }] };
      await saveList(items.map((i) => (i.id === open.id ? updated : i)));
    } catch {
      Alert.alert("Couldn't save that photo", 'Try again, or pick a different photo.');
    }
  }

  function deletePhoto(p: Photo) {
    if (!open) return;
    Alert.alert('Delete this photo?', '', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          removePhotoFile(p);
          const updated = { ...open, photos: (open.photos ?? []).filter((x) => x.file !== p.file) };
          await saveList(items.map((i) => (i.id === open.id ? updated : i)));
        },
      },
    ]);
  }

  // Sends a sample reminder 10 seconds from now so you can see it work.
  async function testReminder() {
    const allowed = await askPermission();
    if (!allowed) {
      Alert.alert('Notifications are off', 'Turn on notifications for Expo Go in your phone settings.');
      return;
    }
    await Notifications.scheduleNotificationAsync({
      content: { title: 'Test reminder', body: 'Your warranty reminders are working.' },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 10, channelId: 'reminders' },
    });
    Alert.alert('Test reminder set', 'Lock your phone or leave the app. It arrives in 10 seconds.');
  }

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Text style={styles.title}>Warranty Drawer</Text>
        <Text style={styles.subtitle}>
          {items.length === 0
            ? 'No appliances yet. Add your first one below.'
            : `${items.length} appliance${items.length === 1 ? '' : 's'}`}
        </Text>

        {showForm ? (
          <View style={styles.form}>
            <Text style={styles.label}>Appliance</Text>
            <TextInput style={styles.input} placeholder="e.g. Dishwasher" placeholderTextColor="#8a93a8" value={name} onChangeText={setName} />

            <Text style={styles.label}>Bought from</Text>
            <TextInput style={styles.input} placeholder="e.g. Home Depot" placeholderTextColor="#8a93a8" value={store} onChangeText={setStore} />

            <Text style={styles.label}>Purchase date</Text>
            {Platform.OS === 'ios' ? (
              <View style={{ alignItems: 'flex-start' }}>
                <DateTimePicker
                  value={fromDateString(date)}
                  mode="date"
                  display="compact"
                  maximumDate={new Date()}
                  onChange={(_e: DateTimePickerEvent, picked?: Date) => picked && setDate(toDateString(picked))}
                />
              </View>
            ) : (
              <Pressable
                style={styles.input}
                onPress={() =>
                  DateTimePickerAndroid.open({
                    value: fromDateString(date),
                    mode: 'date',
                    maximumDate: new Date(),
                    onChange: (e: DateTimePickerEvent, picked?: Date) => {
                      if (e.type === 'set' && picked) setDate(toDateString(picked));
                    },
                  })
                }
              >
                <Text style={{ fontSize: 16, color: '#141a2b' }}>📅 {fromDateString(date).toLocaleDateString()}</Text>
              </Pressable>
            )}

            <Text style={styles.label}>Warranty length</Text>
            <View style={styles.chips}>
              {MONTH_OPTIONS.map((m) => (
                <Pressable key={m} onPress={() => setMonths(m)} style={[styles.chip, months === m && styles.chipOn]}>
                  <Text style={[styles.chipText, months === m && styles.chipTextOn]}>
                    {m / 12} year{m === 12 ? '' : 's'}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.label}>Remind me before it ends</Text>
            <View style={styles.chips}>
              {REMIND_OPTIONS.map((d) => (
                <Pressable key={d} onPress={() => setRemindDays(d)} style={[styles.chip, remindDays === d && styles.chipOn]}>
                  <Text style={[styles.chipText, remindDays === d && styles.chipTextOn]}>{d} days</Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.row}>
              <Pressable style={[styles.button, styles.secondary]} onPress={() => setShowForm(false)}>
                <Text style={styles.secondaryText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.button} onPress={addAppliance}>
                <Text style={styles.buttonText}>Save</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable style={[styles.button, { flex: 0, marginBottom: 16 }]} onPress={() => setShowForm(true)}>
            <Text style={styles.buttonText}>+ Add appliance</Text>
          </Pressable>
        )}

        <FlatList
          data={items}
          keyExtractor={(a) => a.id}
          contentContainerStyle={{ gap: 10, paddingBottom: 40 }}
          renderItem={({ item }) => {
            const s = statusFor(item);
            const reminders = item.notificationIds?.length ?? 0;
            const photos = item.photos ?? [];
            return (
              <Pressable style={styles.card} onPress={() => setOpenId(item.id)} onLongPress={() => deleteAppliance(item)}>
                {photos.length > 0 ? (
                  <Image source={{ uri: photoUri(photos[0]) }} style={styles.thumb} />
                ) : (
                  <View style={[styles.thumb, styles.thumbEmpty]}>
                    <Text style={styles.thumbText}>No photo</Text>
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardName}>{item.name}</Text>
                  <Text style={styles.cardMeta}>
                    {item.store ? `${item.store} · ` : ''}ends {endDate(item).toLocaleDateString()}
                  </Text>
                  <Text style={styles.cardMeta}>
                    {reminders > 0 ? `🔔 ${reminders} reminder${reminders === 1 ? '' : 's'}` : 'No reminders'} · {photos.length} photo{photos.length === 1 ? '' : 's'}
                  </Text>
                </View>
                <Text style={[styles.badge, { color: s.color, borderColor: s.color }]}>{s.label}</Text>
              </Pressable>
            );
          }}
          ListFooterComponent={
            <View style={{ alignItems: 'center', gap: 8, marginTop: 8 }}>
              {items.length > 0 && <Text style={styles.hint}>Tap an appliance to add photos. Press and hold to delete.</Text>}
              <Pressable onPress={testReminder}>
                <Text style={styles.link}>Send a test reminder</Text>
              </Pressable>
            </View>
          }
        />
      </KeyboardAvoidingView>

      {/* Appliance detail screen */}
      <Modal visible={!!open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpenId(null)}>
        {open && (
          <SafeAreaView style={styles.screen}>
            <ScrollView contentContainerStyle={{ gap: 14, paddingBottom: 40 }}>
              <View style={styles.detailHead}>
                <Text style={[styles.title, { flex: 1 }]}>{open.name}</Text>
                <Pressable onPress={() => setOpenId(null)} style={styles.closeBtn}>
                  <Text style={styles.secondaryText}>Done</Text>
                </Pressable>
              </View>

              <View style={styles.form}>
                <Text style={styles.cardMeta}>Bought {fromDateString(open.purchaseDate).toLocaleDateString()}{open.store ? ` at ${open.store}` : ''}</Text>
                <Text style={styles.cardMeta}>
                  Warranty ends {endDate(open).toLocaleDateString()} · {statusFor(open).label}
                </Text>
                <Text style={styles.cardMeta}>
                  {(open.notificationIds?.length ?? 0) > 0 ? `Reminder ${open.remindDays ?? 30} days before, and on the last day` : 'No reminders set'}
                </Text>
              </View>

              <Text style={styles.section}>Receipts & manuals</Text>
              <View style={styles.form}>
                <Text style={styles.label}>This photo is a…</Text>
                <View style={styles.chips}>
                  {(Object.keys(KIND_LABELS) as PhotoKind[]).map((k) => (
                    <Pressable key={k} onPress={() => setPhotoKind(k)} style={[styles.chip, photoKind === k && styles.chipOn]}>
                      <Text style={[styles.chipText, photoKind === k && styles.chipTextOn]}>{KIND_LABELS[k]}</Text>
                    </Pressable>
                  ))}
                </View>
                <View style={styles.row}>
                  <Pressable style={styles.button} onPress={() => addPhoto('camera')}>
                    <Text style={styles.buttonText}>Take photo</Text>
                  </Pressable>
                  <Pressable style={[styles.button, styles.secondary]} onPress={() => addPhoto('library')}>
                    <Text style={styles.secondaryText}>Choose photo</Text>
                  </Pressable>
                </View>
              </View>

              {(open.photos ?? []).length === 0 ? (
                <Text style={styles.hint}>No photos yet. Snap the receipt first. It's what stores ask for when you make a claim.</Text>
              ) : (
                <View style={styles.gallery}>
                  {(open.photos ?? []).map((p) => (
                    <Pressable key={p.file} onPress={() => setViewing(p)} onLongPress={() => deletePhoto(p)} style={styles.photoBox}>
                      <Image source={{ uri: photoUri(p) }} style={styles.photo} />
                      <Text style={styles.photoTag}>{KIND_LABELS[p.kind]}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
              {(open.photos ?? []).length > 0 && <Text style={styles.hint}>Tap a photo to view it. Press and hold to delete it.</Text>}

              <Pressable style={[styles.button, styles.danger, { flex: 0 }]} onPress={() => deleteAppliance(open)}>
                <Text style={styles.dangerText}>Delete appliance</Text>
              </Pressable>
            </ScrollView>
          </SafeAreaView>
        )}

        {/* Full-size photo viewer */}
        <Modal visible={!!viewing} transparent animationType="fade" onRequestClose={() => setViewing(null)}>
          <Pressable style={styles.viewer} onPress={() => setViewing(null)}>
            {viewing && <Image source={{ uri: photoUri(viewing) }} style={styles.viewerImage} resizeMode="contain" />}
            <Text style={styles.viewerHint}>Tap anywhere to close</Text>
          </Pressable>
        </Modal>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#eef1f6', paddingHorizontal: 16 },
  title: { fontSize: 30, fontWeight: '800', color: '#141a2b', marginTop: 12 },
  subtitle: { fontSize: 15, color: '#5d6680', marginBottom: 16 },
  section: { fontSize: 13, fontWeight: '700', color: '#5d6680', textTransform: 'uppercase', letterSpacing: 1 },
  form: { backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 16, gap: 6 },
  label: { fontSize: 13, fontWeight: '600', color: '#5d6680', marginTop: 6 },
  input: { borderWidth: 1, borderColor: '#d5dbe7', borderRadius: 10, padding: 10, fontSize: 16, color: '#141a2b', backgroundColor: '#f7f8fb' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: '#d5dbe7', borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 },
  chipOn: { backgroundColor: '#141a2b', borderColor: '#141a2b' },
  chipText: { color: '#5d6680', fontWeight: '600' },
  chipTextOn: { color: '#fff' },
  row: { flexDirection: 'row', gap: 10, marginTop: 12 },
  button: { flex: 1, backgroundColor: '#2f4bd8', borderRadius: 10, padding: 14, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  secondary: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#d5dbe7' },
  secondaryText: { color: '#141a2b', fontWeight: '700', fontSize: 16 },
  danger: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#b3261e', marginTop: 8 },
  dangerText: { color: '#b3261e', fontWeight: '700', fontSize: 16 },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: '#d5dbe7' },
  thumb: { width: 56, height: 56, borderRadius: 10, backgroundColor: '#eef1f6' },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#d5dbe7' },
  thumbText: { fontSize: 10, color: '#8a93a8', fontWeight: '600' },
  cardName: { fontSize: 17, fontWeight: '700', color: '#141a2b' },
  cardMeta: { fontSize: 13, color: '#5d6680', marginTop: 2 },
  badge: { fontSize: 12, fontWeight: '700', borderWidth: 1.5, borderRadius: 6, paddingVertical: 3, paddingHorizontal: 7, overflow: 'hidden' },
  hint: { textAlign: 'center', color: '#8a93a8', fontSize: 12 },
  link: { color: '#2f4bd8', fontWeight: '600', fontSize: 14, padding: 6 },
  detailHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  closeBtn: { marginTop: 12, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: '#d5dbe7' },
  gallery: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  photoBox: { width: '31%', aspectRatio: 3 / 4, borderRadius: 10, overflow: 'hidden', backgroundColor: '#fff', borderWidth: 1, borderColor: '#d5dbe7' },
  photo: { width: '100%', height: '100%' },
  photoTag: { position: 'absolute', left: 6, bottom: 6, backgroundColor: '#fff', color: '#141a2b', fontSize: 11, fontWeight: '700', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: 'hidden' },
  viewer: { flex: 1, backgroundColor: 'rgba(5,8,15,0.95)', alignItems: 'center', justifyContent: 'center' },
  viewerImage: { width: '100%', height: '85%' },
  viewerHint: { color: '#fff', marginTop: 12, fontSize: 13 },
});
