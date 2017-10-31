const http = require('http');
const fs = require('fs');
const socketio = require('socket.io');

const port = process.env.PORT || process.env.NODE_PORT || 3000;

// read the client html file into memory
// __dirname in node is the current directory
// (in this case the same folder as the server js file)
const index = fs.readFileSync(`${__dirname}/../client/index.html`);
const sandArray = {};


// Create Empty Scene
for (let lx = 0; lx < 100; lx += 1) {
  sandArray[lx] = {};
  for (let ly = 0; ly < 100; ly += 1) {
    sandArray[lx][ly] = Math.floor(Math.random() * (4));
  }
}


const onRequest = (request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html' });
  response.write(index);
  response.end();
};

const app = http.createServer(onRequest).listen(port);

console.log(`Listening on 127.0.0.1: ${port}`);

// pass in the http server into socketio and grab the websocket server as io
const io = socketio(app);

const onJoined = (sock) => {
  const socket = sock;

  socket.on('join', () => {
    socket.join('room1');
    console.log(`${socket.id} joined room1`);

    socket.emit('fullArray', { value: sandArray });
  });
};

const onMsg = (sock) => {
  const socket = sock;

  socket.on('msgToServer', (data) => {
    io.sockets.in('room1').emit('msg', { name: socket.name, msg: data.msg });
  });
};

const onDraw = (sock) => {
  const socket = sock;

  socket.on('draw', (data) => {
    socket.broadcast.emit('drawFromServer', data);
  });
};


const onDisconnect = (sock) => {
  const socket = sock;

  socket.on('disconnect', () => {
    console.log(`${socket.id} Left the chat room`);
    socket.leave('room1');
  });
};


io.sockets.on('connection', (socket) => {
  console.log(`${socket.id} connected`);

  // users[socket.id] = { socket };

  onJoined(socket);
  onMsg(socket);
  onDraw(socket);
  onDisconnect(socket);
});

console.log('Websocket server started');

