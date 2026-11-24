#pragma once

#include "../Manager/StressTestRunner.h"

#include <QList>
#include <QStringList>
#include <QWidget>

#include <vector>

class QBrush;
class QLabel;
class QPushButton;
class QSpinBox;
class QTableWidget;

class StressTestPanel : public QWidget {
	Q_OBJECT

public:
	explicit StressTestPanel(QWidget* parent = nullptr);
	~StressTestPanel() override;

	//Appends one row per result to the table, followed by a total row adding them up
	//testName says which test produced them, every test gets its own row color so the rows can be told apart
	//Returns the total, the time of all the rows added together in milliseconds
	double AddResults(const std::vector<StressResult>& results, const QString& testName);

	//Appends a bold, gray total row that belongs to no single test (e.g. the total of a whole Test All run)
	void AddTotal(const QString& label, double ms, const QString& tooltip);

	//How many splats the test sphere is generated with, set by the spin box in the panel
	size_t SplatCount() const;

	//While a test runs the buttons that start tests are disabled
	//Stop is only usable if the run can be stopped (Test All, between tests)
	void SetRunning(bool running, bool stoppable);

	//Singal to run various stress tests
signals:
	void loadTestRequested();
	void selectTestRequested();
	void moveTestRequested();
	void trimTestRequested();
	void exportTestRequested();
	void deleteTestRequested();
	void undoRedoTestRequested();
	void testAllRequested();
	void stopRequested();

private:
	//Shows the explanation of the selected row under the table, or a hint if no row is selected
	void ShowSelectedDescription();

	//Appends one row, with the tooltip and color on every cell
	void AppendRow(const QString& name, const QString& splats, double ms, const QString& tooltip,
		const QBrush& color, bool bold);

	QTableWidget* m_results = nullptr;
	QLabel* m_description = nullptr;
	QList<QPushButton*> m_runButtons; //Every button that starts something, disabled while a test runs
	QPushButton* m_stopButton = nullptr;
	QSpinBox* m_splatCount = nullptr; //Splats in the test sphere
	QStringList m_testNames; //Tests in the order they first showed results, the position picks the row color
};
