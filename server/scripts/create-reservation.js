import 'dotenv/config';
import mongoose from 'mongoose';
import Reservation from '../src/models/reservationModel.js';
import config from '../src/config.js';
import User from '../src/models/userModel.js';

const createOrFindUserByName = async (name) => {
  // Try to find user by name
  let user = await User.findOne({ name: name.trim() });

  if (!user) {
    // Create minimal historical user
    user = await User.create({
      name: name.trim(),
      email: null, // no email
      password: null, // no password
      role: 'guest', // optional role
    });
    console.log('Created minimal user:', user.name, user._id);
  } else {
    console.log('Matched existing user:', user.name, user._id);
  }

  return user._id;
};

const start = async () => {
  try {
    // 1. Connect to MongoDB
    const DB = config.db.uri;

    await mongoose
      .connect(DB)
      .then(() => console.log('Adatbázis kapcsolat sikeres!'));

    const tourId = '69254077db0359d5c8dfa4f0'; //folyt a 5-kal
    const bookedById = '69207fe63c5f751cc685439f';

    // const names = ['Gazda Lajos', 'Vargyas Enikő', 'Gazda Janka', 'Gazda Ilka'];
    // const names = ['Dali Csaba', 'Dali Jutka', 'Dali Botond', 'Dali Boglárka'];
    // const names = [
    //   'Nagy Zoltán',
    //   'Bíró Melinda',
    //   'Nagy Bálint',
    //   'Nagy András',
    //   'Bíró Angéla',
    // ];
    const names = [
      'Grünblatt Csaba',
      'Grünblatt Jutka',
      'Grünblatt Eszter',
      'Grünblatt Réka',
    ];
    // const names = ['Gáspár Áron', 'Gáspár Tünde', 'Gáspár Bálint'];
    // const names = [
    //   'Mócsi Sándor',
    //   'Hochrein Anita',
    //   'Mócsi László',
    //   'Mócsi Attila',
    // ];
    // const names = ['Kovács Zoltán', 'Lovász Ágnes', 'Kovács Katalin', 'Kovács Miklós'];
    // const names = ['Kovács Zoltán', 'Lovász Ágnes'];
    // const names = [
    //   'Lloret Wilbert',
    //   'Lloret Enikő',
    //   'Lloret Péter',
    //   'Lloret Adrienn',
    // ];
    // const names = [
    //   'Szabó Novák Gábor',
    //   'Szabó Novák Niki',
    //   'Szabó Novák Szonja',
    //   'Szabó Novák Ádi',
    // ];
    // const names = [
    //   'Antalfy Huba',
    //   'Páll Zita',
    //   'Antalfy Balázs',
    //   'Antalfy Zalán',
    // ];

    // Create or find user for each attendee
    const attendees = await Promise.all(
      names.map(async (name) => {
        const userId = await createOrFindUserByName(name);
        return { user: userId, name };
      }),
    );

    // 6. Create reservation
    const reservation = await Reservation.create({
      tour: tourId,
      bookedBy: bookedById,
      attendees,
      paid: true,
    });

    console.log('\nReservation created successfully:\n');
    console.log(reservation);

    process.exit(0);
  } catch (err) {
    console.error('\nError:', err.message);
    process.exit(1);
  }
};

start();
