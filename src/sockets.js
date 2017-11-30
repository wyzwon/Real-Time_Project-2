let io;

const configure = (ioServer) => {
  io = ioServer;

  io.on('connection', (sock) => {
    const socket = sock;
    socket.join('room1');


    socket.on('movementUpdate', (data) => {
      socket.square = data;
      socket.square.lastUpdate = Date.now();

      // socket.broadcast.to('room1').emit('updatedMovement', socket.square);
      // io.sockets.in('room1').emit('updatedMovement', socket.square);
    });

    socket.on('disconnect', () => {
      io.sockets.in('room1').emit('left', socket.square.hash);

      socket.leave('room1');
    });
  });
};

module.exports.configure = configure;


/* io.sockets.on('connection', (socket) => {
  // console.log(`${socket.id} connected`);

  // users[socket.id] = { socket };

  onJoined(socket);
  onMsg(socket);
  onDraw(socket);
  onDisconnect(socket);
}); */
