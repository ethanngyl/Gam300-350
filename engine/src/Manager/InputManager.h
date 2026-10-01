#pragma once
#include <vector>
#include <functional>

class InputManager
{
public:

	//State of the inputs
	//e.g. Dragging Objects, Camera, etc
	enum STATE
	{
		NONE, //First state enum

		NORMAL,

		ALL_STATES //Last state enum
	};

	enum KEY_ACTIONS
	{
		LEFT_CLICK,
		RIGHT_CLICK,
		SCROLL,

		FORWARD,
		BACKSWARD,
		LEFT,
		RIGHT,

		ALL_ACTIONS
	};

	enum INPUT_TYPE
	{
		PRESS,
		HOLD,
		RELEASE,
		ALL_INPUTS
	};

	InputManager() = default;

	STATE GetState() const { return m_inputState; }
	double GetDx() const { return m_dx; }
	double GetDy() const { return m_dy; }
	double GetScrollY() const { return m_scrollY; }

	//Key and button codes are Qt's (Qt::Key_*, Qt::MouseButton)
	void CallbackMouseClick(int button, INPUT_TYPE inputType, double dx, double dy);
	void CallbackMouseScroll(double yScroll);
	void CallbackKeyPress(int key, INPUT_TYPE inputType);

	//If stateTriiger is ALL_STATES, it places it into every state's callback
	void AddCallBack(STATE stateTrigger, KEY_ACTIONS action, std::function<void(InputManager& manager, INPUT_TYPE inputType)>);

private:
	void TriggerCallback(KEY_ACTIONS action, INPUT_TYPE inputType);

	STATE m_inputState = NORMAL;

	//Array of vectors, based on each 
	//- state
	//- key action (Click, pan, keyt press)
	//- input type (hold, release, etc)
	std::vector<std::function<void(InputManager&, INPUT_TYPE inputType)>> m_inputCallback[ALL_STATES][ALL_ACTIONS];

	//Mouse movement
	double m_dx = 0 ;
	double m_dy = 0;
	double m_scrollY = 0;
};